/**
 * Module to load/save options to preferences. Options are represented
 * as a dictionary with the following fields:
 *
 *     default_workspace_gid {String} ID of the workspace that tasks should
 *         go into by default. The user will be allowed to choose a
 *         different option when adding a task. This is "0" if no default
 *         workspace is selected and we'll try to use the last used space.
 *
 * They are stored off in browser local storage for the extension as a
 * single serialized string, read/written all-or-nothing.
 */
Asana.Options = {

  /**
   * @return {dict} Default options.
   */
  defaultOptions: function() {
    return {
      default_workspace_gid: '0',
      last_used_workspace_gid: '0'
    };
  },

  /**
   * Load the user's preferences synchronously from local storage.
   *
   * @return {dict} The user's stored options
   */
  loadOptions: function() {
    var options_json = localStorage.options;
    var options;
    if (!options_json) {
      options = this.defaultOptions();
      localStorage.options = JSON.stringify(options);
      return options;
    } else {
      options = JSON.parse(options_json);
      return options;
    }
  },

  /**
   * Save the user's preferences synchronously to local storage.
   * Overwrites only changed options.
   *
   * @param options {dict} The user's options.
   */
  saveOptions: function(options) {
    var options_json_parsed = JSON.parse(localStorage.options);
    Object.keys(options).forEach(key => options_json_parsed[key] = options[key]);
    localStorage.options = JSON.stringify(options_json_parsed);
  },

  /**
   * Reset the user's preferences to the defaults.
   */
  resetOptions: function() {
    delete localStorage.options;
    this.loadOptions();
  }

};

var init = function() {
  fillOptions();
  $('#reset_button').addEventListener('click', resetOptions);
};

// Restores select box state to saved value from localStorage.
var fillOptions = function() {
  var options = Asana.Options.loadOptions();
  $('#workspaces_group').value = options.default_workspace_gid;
  fillWorkspacesInBackground(options);
};

var fillWorkspacesInBackground = function(opt_options) {
  var options = opt_options || Asana.Options.loadOptions();
  Asana.ServerModel.workspaces(function(workspaces) {
    $('#workspaces_group').innerHTML = '<li><label><input name="workspace_gid" type="radio" id="workspace_gid-0" key="0"><b>Last used workspace</b></label></li>';
    workspaces.forEach(function(workspace) {
      var workspaceGid = document.createElement('li');
      workspaceGid.innerHTML = '<label><input name="workspace_gid" type="radio" id="workspace_gid-' +
        workspace.gid + '" key="' + workspace.gid + '"/>' + workspace.name + '</label>';
      $('#workspaces_group').append(workspaceGid);
    });
    var default_workspace_element = $('#workspace_gid-' + options.default_workspace_gid);
    if (default_workspace_element) {
      default_workspace_element.checked = true;
    } else {
      $('#workspaces_group input').checked = true;
    }
    $$('#workspaces_group input').forEach(input => input.addEventListener('change', onChange));
  }, function(error_response) {
    $('#workspaces_group').innerHTML =
        '<div>Error loading workspaces. Verify the following:<ul>' +
            '<li>Asana Host is configured correctly.</li>' +
            '<li>You are <a target="_blank" href="https://app.asana.com/">logged in</a>.</li>' +
            '<li>You have access to the Asana API.</li></ul>';
  });
};

var onChange = function() {
  setSaveEnabled(true);
};

var setSaveEnabled = function(enabled) {
  var button = $('#save_button');
  if (enabled) {
    button.classList.remove('disabled');
    button.classList.add('enabled');
    button.addEventListener('click', saveOptions);
  } else {
    button.classList.remove('enabled');
    button.classList.add('disabled');
    button.removeEventListener('click', saveOptions);
  }
};

var resetOptions = function() {
  Asana.Options.resetOptions();
  fillOptions();
  setSaveEnabled(false);
};

var saveOptions = function() {
  var default_workspace_input = $('input[name="workspace_gid"]:checked');
  // Somehow we can't directly call default_workspace_input['key']
  Asana.Options.saveOptions({
    default_workspace_gid: default_workspace_input.getAttribute('key')
  });
  setSaveEnabled(false);
  $('#status').innerHTML = 'Options saved.';
  setTimeout(function() {
    $('#status').innerHTML = '';
  }, 3000);

  fillWorkspacesInBackground();
};
