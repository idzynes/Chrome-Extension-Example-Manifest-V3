/**
 * Define the top-level Asana namespace.
 */
Asana = {};


/**
 * Functionality to communicate with the Asana API. This should get loaded
 * in the "server" portion of the chrome extension because it will make
 * HTTP requests and needs cross-domain privileges.
 *
 * The bridge does not need to use an auth token to connect to
 * the API. Since it is a browser extension it can access the user's cookies
 * and can use them to authenticate to the API. This capability is specific
 * to browser extensions, and other types of applications would have to obtain
 * an auth token to communicate with the API.
 */
Asana.ApiBridge = {

  /**
   * @type {String} Version of the Asana API to use.
   */
  API_VERSION: '1.0',

  /**
   * @type {Integer} How long an entry stays in the cache.
   */
  CACHE_TTL_MS: 15 * 60 * 1000,

  /**
   * @type {Boolean} Set to true on the server (background page), which will
   *     actually make the API requests. Clients will just talk to the API
   *     through the ExtensionServer.
   *
   */
  is_server: false,

  /**
   * @type {dict} Map from API path to cache entry for recent GET requests.
   *     date {Date} When cache entry was last refreshed
   *     response {*} Cached request.
   */
  _cache: {},

  /**
   * @return {String} The base URL to use for API requests.
   */
  baseApiUrl: function() {
    return 'https://app.asana.com/api/' + this.API_VERSION;
  },

  /**
   * Make a request to the Asana API.
   *
   * @param http_method {String} HTTP request method to use (e.g. 'POST')
   * @param path {String} Path to call.
   * @param params {dict} Parameters for API method; depends on method.
   * @param callback {Function(response: dict)} Callback on completion.
   *     status {Integer} HTTP status code of response.
   *     data {dict} Object representing response of API call, depends on
   *         method. Only available if response was a 200.
   *     error {String?} Error message, if there was a problem.
   * @param options {dict?}
   *     miss_cache {Boolean} Do not check cache before requesting
   */
  request: function(http_method, path, params, callback, options) {
    var me = this;
    http_method = http_method.toUpperCase();

    // If we're not the server page, send a message to it to make the
    // API request.
    if (!me.is_server) {
      console.info('Client API Request', http_method, path, params);
      chrome.runtime.sendMessage({
        type: 'api',
        method: http_method,
        path: path,
        params: params,
        options: options || {}
      }, callback);
      return;
    }

    console.info('Server API Request', http_method, path, params);

    // Serve from cache first.
    if (!options.miss_cache && http_method === 'GET') {
      var data = me._readCache(path, new Date());
      if (data) {
        console.log('Serving request from cache', path);
        callback(data);
        return;
      }
    }

    // Be polite to Asana API and tell them who we are.
    var manifest = chrome.runtime.getManifest();
    var client_name = [
      'chrome-extension',
      chrome.i18n.getMessage('@@extension_id'),
      manifest.version,
      manifest.name
    ].join(':');

    var url = me.baseApiUrl() + path;
    var body_data;
    if (http_method === 'PUT' || http_method === 'POST') {
      // POST/PUT request, put params in body
      body_data = {
        data: params,
        options: { client_name: client_name }
      };
    } else {
      // GET/DELETE request, add params as URL parameters.
      Object.assign(params, {opt_client_name: client_name});
      url += '?' + Object.keys(params).map(key => {
        return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
      }).join('&');
    }

    console.log('Making request to API', http_method, url);

    chrome.cookies.get({
      url: url,
      name: 'ticket'
    }, function(cookie) {
      if (!cookie) {
        callback({
          status: 401,
          error: 'Not Authorized'
        });
        return;
      }

      // Note that any URL fetched here must be matched by a permission in
      // the manifest.json file!
      var attrs = {
        method: http_method,
        timeout: 30000,   // 30 second timeout
        headers: {
          'Content-Type': 'application/json',
          'X-Allow-Asana-Client': '1'
        }
      };
      if (http_method === 'POST' || http_method === 'PUT') {
        attrs.body = JSON.stringify(body_data);
        attrs.dataType = 'json';
        attrs.processData = false;
      }

      fetch(url, attrs)
      .then(response => {
        if (!response.ok) {
          console.log('Response not ok', response.json());
        }
        return response.json();
      })
      .then(responseJson => {
        if (http_method === 'GET') {
          me._writeCache(responseJson.path, responseJson.data, new Date());
        }
        console.log('Successful response', responseJson);
        callback(responseJson);
      })
      .catch(response => {
        console.log('Failed response', response);
        try {
          callback(response.json());
        } catch (e) {
          callback({errors: [{message: 'Could not parse response from server' }]});
        }
      });
      return true;

    });
  },

  _readCache: function(path, date) {
    var entry = this._cache[path];
    if (entry && entry.date >= date - this.CACHE_TTL_MS) {
      return entry.response;
    }
    return null;
  },

  _writeCache: function(path, response, date) {
    this._cache[path] = {
      response: response,
      date: date
    };
  }
};


/**
 * The "server" portion of the chrome extension, which listens to events
 * from other clients such as the popup or per-page content windows.
 */
Asana.ExtensionServer = {

  /**
   * Call from the background page: listen to chrome events and
   * requests from page clients, which can't make cross-domain requests.
   */
  listen: function() {
    var me = this;

    // Mark our Api Bridge as the server side (the one that actually makes
    // API requests to Asana vs. just forwarding them to the server window).
    Asana.ApiBridge.is_server = true;

    chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
      if (request.type === 'api') {
        // Request to the API. Pass it on to the bridge.
        Asana.ApiBridge.request(
            request.method, request.path, request.params, sendResponse,
            request.options || {});
        return true;  // will call sendResponse asynchronously
      }
    });
  }

};


/**
 * Library of functions for the "server" portion of an extension, which is
 * loaded into the background and popup pages.
 *
 * Some of these functions are asynchronous, because they may have to talk
 * to the Asana API to get results.
 */
Asana.ServerModel = {

  // Make requests to API to refresh cache at this interval.
  CACHE_REFRESH_INTERVAL_MS: 15 * 60 * 1000, // 15 minutes

  _url_to_cached_image: {},

  /**
   * Called by the model whenever a request is made and error occurs.
   * Override to handle in a context-appropriate way. Some requests may
   * also take an `errback` parameter which will handle errors with
   * that particular request.
   *
   * @param response {dict} Response from the server.
   */
  onError: function(response) {},

  /**
   * Requests the user's preferences for the extension.
   *
   * @param callback {Function(options)} Callback on completion.
   */
  options: function(callback) {
    chrome.storage.sync.get({
      defaultWorkspaceGid: '0',
      lastUsedWorkspaceGid: '0'
    }, function(options) {
      callback(options);
    });
  },

  /**
   * Determine if the user is logged in.
   *
   * @param callback {Function(is_logged_in)} Called when request complete.
   *     is_logged_in {Boolean} True iff the user is logged in to Asana.
   */
  isLoggedIn: function(callback) {
    chrome.cookies.get({
      url: Asana.ApiBridge.baseApiUrl(),
      name: 'ticket'
    }, function(cookie) {
      callback(!!(cookie && cookie.value));
    });
  },

  /**
   * Get the URL of a task given some of its data.
   *
   * @param task {dict}
   * @param callback {Function(url)}
   */
  taskViewUrl: function(task, callback) {
    // We don't know what pot to view it in so we just use the task ID
    // and Asana will choose a suitable default.
    var pot_gid = task.gid;
    var url = 'https://app.asana.com/0/' + pot_gid + '/' + task.gid;
    callback(url);
  },

  /**
   * Requests the set of workspaces the logged-in user is in.
   *
   * @param callback {Function(workspaces)} Callback on success.
   *     workspaces {dict[]}
   */
  workspaces: function(callback, errback, options) {
    var self = this;
    Asana.ApiBridge.request('GET', '/workspaces', {},
        function(response) {
          self._makeCallback(response, callback, errback);
        }, options);
  },

  /**
   * Requests the set of users in a workspace.
   *
   * @param callback {Function(users)} Callback on success.
   *     users {dict[]}
   */
  users: function(workspace_gid, callback, errback, options) {
    var self = this;
    Asana.ApiBridge.request(
        'GET', '/workspaces/' + workspace_gid + '/users',
        { opt_fields: 'name,photo.image_60x60' },
        function(response) {
          response.forEach(function (user) {
            self._updateUser(workspace_gid, user);
          });
          self._makeCallback(response, callback, errback);
        }, options);
  },

  /**
   * Requests the user record for the logged-in user.
   *
   * @param callback {Function(user)} Callback on success.
   *     user {dict[]}
   */
  me: function(callback, errback, options) {
    var self = this;
    Asana.ApiBridge.request('GET', '/users/me', {},
        function(response) {
          self._makeCallback(response, callback, errback);
        }, options);
  },

  /**
   * Makes an Asana API request to add a task in the system.
   *
   * @param task {dict} Task fields.
   * @param callback {Function(response)} Callback on success.
   */
  createTask: function(workspace_gid, task, callback, errback) {
    var self = this;
    Asana.ApiBridge.request(
        'POST',
        '/workspaces/' + workspace_gid + '/tasks',
        task,
        function(response) {
          self._makeCallback(response, callback, errback);
        });
  },

  /**
   * Requests user type-ahead completions for a query.
   */
  userTypeahead: function(workspace_gid, query, callback, errback) {
    var self = this;

    Asana.ApiBridge.request(
      'GET',
      '/workspaces/' + workspace_gid + '/typeahead',
      {
        type: 'user',
        query: query,
        count: 10,
        opt_fields: 'name,photo.image_60x60',
      },
      function(response) {
        self._makeCallback(
          response,
          function (users) {
            users.forEach(function (user) {
              self._updateUser(workspace_gid, user);
            });
            callback(users);
          },
          errback);
      },
      {
        miss_cache: true, // Always skip the cache.
      });
  },

  /**
   * All the users that have been seen so far, keyed by workspace and user.
   */
  _known_users: {},

  _updateUser: function(workspace_gid, user) {
    this._known_users[workspace_gid] = this._known_users[workspace_gid] || {};
    this._known_users[workspace_gid][user.gid] = user;
    this._cacheUserPhoto(user);
  },

  _makeCallback: function(response, callback, errback) {
    if (response.errors) {
      (errback || this.onError).call(null, response);
    } else {
      callback(response.data);
    }
  },

  _cacheUserPhoto: function(user) {
    var me = this;
    if (user.photo) {
      var url = user.photo.image_60x60;
      if (!(url in me._url_to_cached_image)) {
        var image = new Image();
        image.src = url;
        me._url_to_cached_image[url] = image;
      }
    }
  },

  /**
   * Start fetching all the data needed by the extension so it is available
   * whenever a popup is opened.
   */
  startPrimingCache: function() {
    var me = this;
    me._cache_refresh_interval = setInterval(function() {
      me.refreshCache();
    }, me.CACHE_REFRESH_INTERVAL_MS);
    me.refreshCache();
  },

  refreshCache: function() {
    var me = this;
    // Fetch logged-in user.
    me.me(function(user) {
      if (!user.errors) {
        // Fetch list of workspaces.
        me.workspaces(function(workspaces) {}, null, { miss_cache: true });
      }
    }, null, { miss_cache: true });
  }
};


Asana.ExtensionServer.listen();
Asana.ServerModel.startPrimingCache();

// Modify referer header sent to typekit, to allow it to serve to us.
// See http://stackoverflow.com/questions/12631853/google-chrome-extensions-with-typekit-fonts
chrome.webRequest.onBeforeSendHeaders.addListener(function(details) {
  var requestHeaders = details.requestHeaders;
  for (var i = 0; i < requestHeaders.length; ++i) {
    if (requestHeaders[i].name.toLowerCase() === 'referer') {
      // The request was certainly not initiated by a Chrome extension...
      return;
    }
  }
  // Set Referer
  requestHeaders.push({
    name: 'referer',
    // Host must match the domain in our Typekit kit settings
    value: 'https://abkfopjdddhbjkiamjhkmogkcfedcnml'
  });
  return {
    requestHeaders: requestHeaders
  };
}, {
  urls: ['*://use.typekit.net/*'],
  types: ['stylesheet', 'script']
}, ['requestHeaders','blocking']);
