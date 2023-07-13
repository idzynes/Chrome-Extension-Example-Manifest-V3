/**
 * Code for the popup UI.
 */
Popup = {

  // Is this an external popup window? (vs. the one from the menu)
  is_external: false,

  // Options loaded when popup opened.
  options: null,

  // Info from page we were triggered from
  page_title: null,
  page_url: null,
  page_selection: null,
  favicon_url: null,

  // State to track so we only log events once.
  has_edited_name: false,
  has_edited_notes: false,
  has_reassigned: false,
  has_used_page_details: false,
  is_first_add: true,

  // Data from API cached for this popup.
  workspaces: null,
  users: null,
  user_gid: null,
  
  // Typeahead ui element
  typeahead: null,

  onLoad: function() {
    var me = this;

    me.is_external = ('' + window.location.search).indexOf('external=true') !== -1;

    // Our default error handler.
    Asana.ServerModel.onError = function(response) {
      me.showError(response.errors[0].message);
    };

    // Ah, the joys of asynchronous programming.
    // To initialize, we've got to gather various bits of information.
    // Starting with a reference to the window and tab that were active when
    // the popup was opened ...
    chrome.tabs.query({
      active: true,
      currentWindow: true
    }, function(tabs) {
      var tab = tabs[0];
      // Now load our options ...
      Asana.ServerModel.options(function(options) {
        me.options = options;
        // And ensure the user is logged in ...
        Asana.ServerModel.isLoggedIn(function(is_logged_in) {
          if (is_logged_in) {
            if (window.quick_add_request) {
              Asana.ServerModel.logEvent({
                name: 'ChromeExtension-Open-QuickAdd'
              });
              // If this was a QuickAdd request (set by the code popping up
              // the window in Asana.ExtensionServer), then we have all the
              // info we need and should show the add UI right away.
              me.showAddUi(
                  quick_add_request.url, quick_add_request.title,
                  quick_add_request.selected_text,
                  quick_add_request.favicon_url);
            } else {
              Asana.ServerModel.logEvent({
                name: 'ChromeExtension-Open-Button'
              });
              // Otherwise we want to get the selection from the tab that
              // was active when we were opened. So we set up a listener
              // to listen for the selection send event from the content
              // window ...
              var selection = '';
              var listener = function(request, sender, sendResponse) {
                if (request.type === 'selection') {
                  chrome.runtime.onMessage.removeListener(listener);
                  console.info('Asana popup got selection');
                  selection = '\n' + request.value;
                }
              };
              chrome.runtime.onMessage.addListener(listener);
              me.showAddUi(tab.url, tab.title, '', tab.favIconUrl);
            }
          } else {
            // The user is not even logged in. Prompt them to do so!
            me.showLogin(
                Asana.Options.loginUrl(options),
                Asana.Options.signupUrl(options));
          }
        });
      });
    });

    // Wire up some events to DOM elements on the page.

    window.addEventListener('keydown', function(e) {
      // Close the popup if the ESCAPE key is pressed.
      if (e.which === 27) {
        if (me.is_first_add) {
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-Abort'
          });
        }
        window.close();
      } else if (e.which === 9) {
        // Don't let ourselves TAB to focus the document body, so if we're
        // at the beginning or end of the tab ring, explicitly focus the
        // other end (setting body.tabindex = -1 does not prevent this)
        if (e.shiftKey && document.activeElement === me.firstInput()[0]) {
          me.lastInput().focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === me.lastInput()[0]) {
          me.firstInput().focus();
          e.preventDefault();
        }
      }
    });

    // Close if the X is clicked.
    $$('.close-x').forEach(el => el.addEventListener(
      'click', function() {
        if (me.is_first_add) {
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-Abort'
          });
        }
        window.close();
      })
    );

    $('#name_input').addEventListener('keyup', function() {
      if (!me.has_edited_name && $('#name_input').value !== '') {
        me.has_edited_name = true;
        Asana.ServerModel.logEvent({
          name: 'ChromeExtension-ChangedTaskName'
        });
      }
      me.maybeDisablePageDetailsButton();
    });
    $('#notes_input').addEventListener('keyup', function() {
      if (!me.has_edited_notes && $('#notes_input').value !== '') {
        me.has_edited_notes= true;
        Asana.ServerModel.logEvent({
          name: 'ChromeExtension-ChangedTaskNotes'
        });
      }
      me.maybeDisablePageDetailsButton();
    });

    // The page details button fills in fields with details from the page
    // in the current tab (cached when the popup opened).
    var use_page_details_button = $('#use_page_details');
    use_page_details_button.addEventListener('click', function() {
      if (!(use_page_details_button.classList.contains('disabled'))) {
        // Page title -> task name
        $('#name_input').value = me.page_title;
        // Page url + selection -> task notes
        var notes = $('#notes_input');
        notes.value = notes.value + me.page_url + '\n' + me.page_selection;
        // Disable the page details button once used.        
        use_page_details_button.classList.add('disabled');
        if (!me.has_used_page_details) {
          me.has_used_page_details = true;
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-UsedPageDetails'
          });
        }
      }
    });
    // Make a typeahead for assignee
    me.typeahead = new UserTypeahead('assignee');
  },

  maybeDisablePageDetailsButton: function() {
    if ($('#name_input').value !== '' || $('#notes_input').value !== '') {
      $('#use_page_details').classList.add('disabled');
    } else {
      $('#use_page_details').classList.remove('disabled');
    }
  },

  setExpandedUi: function(is_expanded) {
    if (this.is_external) {
      window.resizeTo(
          Asana.POPUP_UI_WIDTH,
          (is_expanded ? Asana.POPUP_EXPANDED_UI_HEIGHT : Asana.POPUP_UI_HEIGHT)
              + Asana.CHROME_TITLEBAR_HEIGHT);
    }
  },

  showView: function(name) {
    ['login', 'add'].forEach(function(view_name) {
      $('#' + view_name + '_view').style.display = view_name === name ? '' : 'none';
    });
  },

  showAddUi: function(url, title, selected_text, favicon_url) {
    var me = this;

    // Store off info from page we got triggered from.
    me.page_url = url;
    me.page_title = title;
    me.page_selection = selected_text;
    me.favicon_url = favicon_url;

    // Populate workspace selector and select default.
    Asana.ServerModel.me(function(user) {
      me.user_gid = user.gid;
      Asana.ServerModel.workspaces(function(workspaces) {
        me.workspaces = workspaces;
        var select = $('#workspace_select');
        select.innerHTML = '';
        workspaces.forEach(function(workspace) {
          var workspaceOption = document.createElement('option');
          workspaceOption.value = workspace.gid;
          workspaceOption.textContent = workspace.name;
          $('#workspace_select').append(workspaceOption);
        });
        if (workspaces.length > 1) {
          $('#workspace_select_container').style.display = '';
        } else {
          $('#workspace_select_container').style.display = 'none';
        }
        select.value = me.options.default_workspace_gid;
        me.onWorkspaceChanged();
        select.addEventListener('change', function() {
          if (select.value !== me.options.default_workspace_gid) {
            Asana.ServerModel.logEvent({
              name: 'ChromeExtension-ChangedWorkspace'
            });
          }
          me.onWorkspaceChanged();
        });

        // Set initial UI state
        me.resetFields();
        me.showView('add');
        var name_input = $('#name_input');
        name_input.focus();
        name_input.select();

        if (favicon_url) {
          $$('.icon-use-link').forEach(el => el.style.backgroundImage = 'url(' + favicon_url + ')');
        } else {
          $$('.icon-use-link').forEach(el => el.classList.add('no-favicon', 'sprite'));
        }
      });
    });
  },

  /**
   * @param enabled {Boolean} True iff the add button should be clickable.
   */
  setAddEnabled: function(enabled) {
    var me = this;
    var button = $('#add_button');
    var createTaskOnClick = function() {
      me.createTask();
      return false;
    };
    var createTaskWithEnter = function(e) {
      if (e.keyCode === 13) {
        me.createTask();
      }
    };
    if (enabled) {
      // Update appearance and add handlers.
      button.classList.remove('is-disabled');
      button.removeEventListener('click', createTaskOnClick);
      button.removeEventListener('keydown', createTaskWithEnter);
      button.addEventListener('click', createTaskOnClick);
      button.addEventListener('keydown', createTaskWithEnter);
    } else {
      // Update appearance and remove handlers.
      button.classList.add('is-disabled');
      button.removeEventListener('click', createTaskOnClick);
      button.removeEventListener('keydown', createTaskWithEnter);
    }
  },

  showError: function(message) {
    console.log('Error: ' + message);
    $('#error').style.display = 'inline-block';
  },

  hideError: function() {
    $('#error').style.display = 'none';
  },

  /**
   * Clear inputs for new task entry.
   */
  resetFields: function() {
    $('#name_input').value = '';
    $('#notes_input').value = '';
    this.typeahead.setSelectedUserId(this.user_gid);
  },

  /**
   * Set the add button as being 'working', waiting for the Asana request
   * to complete.
   */
  setAddWorking: function(working) {
    this.setAddEnabled(!working);
    $('#add_button .new-button-text').textContent =
        working ? 'Adding...' : 'Add to Asana';
  },

  /**
   * Update the list of users as a result of setting/changing the workspace.
   */
  onWorkspaceChanged: function() {
    var me = this;
    var workspace_gid = me.selectedWorkspaceId();

    // Update selected workspace
    console.log($('#workspace_select'));
    $('#workspace').innerHTML = ($('#workspace_select option:checked')).textContent;

    // Save selection as new default.
    Popup.options.default_workspace_gid = workspace_gid;
    Asana.ServerModel.saveOptions(me.options, function() {});

    me.setAddEnabled(true);
  },

  /**
   * @param gid {String}
   * @return {dict} Workspace data for the given workspace.
   */
  workspaceById: function(gid) {
    var found = null;
    this.workspaces.forEach(function(w) {
      if (w.gid === gid) {
        found = w;
      }
    });
    return found;
  },

  /**
   * @return {String} ID of the selected workspace.
   */
  selectedWorkspaceId: function() {
    return $('#workspace_select').value;
  },

  /**
   * Create a task in asana using the data in the form.
   */
  createTask: function() {
    var me = this;

    // Update UI to reflect attempt to create task.
    console.info('Creating task');
    me.hideError();
    me.setAddWorking(true);

    if (!me.is_first_add) {
      Asana.ServerModel.logEvent({
        name: 'ChromeExtension-CreateTask-MultipleTasks'
      });
    }

    Asana.ServerModel.createTask(
        me.selectedWorkspaceId(),
        {
          name: $('#name_input').value,
          notes: $('#notes_input').value,
          // Default assignee to self
          assignee: me.typeahead.selected_user_gid || me.user_gid
        },
        function(task) {
          // Success! Show task success, then get ready for another input.
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-CreateTask-Success'
          });
          me.setAddWorking(false);
          me.showSuccess(task);
          me.resetFields();
          $('#name_input').focus();
        },
        function(response) {
          // Failure. :( Show error, but leave form available for retry.
          Asana.ServerModel.logEvent({
            name: 'ChromeExtension-CreateTask-Failure'
          });
          me.setAddWorking(false);
          me.showError(response.errors[0].message);
        });
  },

  /**
   * Helper to show a success message after a task is added.
   */
  showSuccess: function(task) {
    var me = this;
    Asana.ServerModel.taskViewUrl(task, function(url) {
      var name = task.name.replace(/^\s*/, '').replace(/\s*$/, '');
      var link = $('#new_task_link');
      link.href = url;
      link.textContent = name !== '' ? name : 'Task';
      var openCreatedTaskOnClick = function() {
        chrome.tabs.create({url: url});
        window.close();
        return false;
      };
      link.removeEventListener('click', openCreatedTaskOnClick);
      link.addEventListener('click', openCreatedTaskOnClick);

      // Reset logging for multi-add
      me.has_edited_name = true;
      me.has_edited_notes = true;
      me.has_reassigned = true;
      me.is_first_add = false;

      $('#success').style.display = 'inline-block';
    });
  },

  /**
   * Show the login page.
   */
  showLogin: function(login_url, signup_url) {
    var me = this;
    $('#login_button').addEventListener('click', (function() {
      chrome.tabs.create({url: login_url});
      window.close();
      return false;
    }));
    $('#signup_button').addEventListener('click', (function() {
      chrome.tabs.create({url: signup_url});
      window.close();
      return false;
    }));
    me.showView('login');
  },

  firstInput: function() {
    return $('#workspace_select');
  },

  lastInput: function() {
    return $('#add_button');
  }
};

/**
 * A jQuery-based typeahead similar to the Asana application, which allows
 * the user to select another user in the workspace by typing in a portion
 * of their name and selecting from a filtered dropdown.
 *
 * Expects elements with the following IDs already in the DOM
 *   ID: the element where the current assignee will be displayed.
 *   ID_input: an input element where the user can edit the assignee
 *   ID_list: an empty DOM whose children will be populated from the users
 *       in the selected workspace, filtered by the input text.
 *   ID_list_container: a DOM element containing ID_list which will be
 *       shown or hidden based on whether the user is interacting with the
 *       typeahead.
 *
 * @param gid {String} Base ID of the typeahead element.
 * @constructor
 */
UserTypeahead = function(gid) {
  var me = this;
  me.gid = gid;
  me.users = [];
  me.filtered_users = [];
  me.user_gid_to_user = {};
  me.selected_user_gid = null;
  me.user_gid_to_select = null;
  me.has_focus = false;

  me._request_counter = 0;

  // Store off UI elements.
  me.input = $('#' + gid + '_input');
  me.token_area = $('#' + gid + '_token_area');
  me.token = $('#' + gid + '_token');
  me.list = $('#' + gid + '_list');
  me.list_container = $('#' + gid + '_list_container');

  // Open on focus.
  me.input.addEventListener('focus', function() {
    me.user_gid_to_select = me.selected_user_gid;
    if (me.selected_user_gid !== null) {
      // If a user was already selected, fill the field with their name
      // and select it all.  The user_gid_to_user dict may not be populated yet.
      if (me.user_gid_to_user[me.selected_user_gid]) {
        var assignee_name = me.user_gid_to_user[me.selected_user_gid].name;
        me.input.value = assignee_name;
      } else {
        me.input.value = '';
      }
    } else {
      me.input.value = '';
    }
    me.has_focus = true;
    Popup.setExpandedUi(true);
    me._updateUsers();
    me.render();
    me._ensureSelectedUserVisible();
    me.token_area.tabindex = '-1';
  });

  // Close on blur. A natural blur does not cause us to accept the current
  // selection - there had to be a user action taken that causes us to call
  // `confirmSelection`, which would have updated user_gid_to_select.
  me.input.addEventListener('blur', function() {
    me.selected_user_gid = me.user_gid_to_select;
    me.has_focus = false;
    if (!Popup.has_reassigned) {
      Popup.has_reassigned = true;
      Asana.ServerModel.logEvent({
        name: (me.selected_user_gid === Popup.user_gid || me.selected_user_gid === null) ?
            'ChromeExtension-AssignToSelf' :
            'ChromeExtension-AssignToOther'
      });
    }
    me.render();
    Popup.setExpandedUi(false);
    me.token_area.tabindex = '0';
  });

  // Handle keyboard within input
  me.input.addEventListener('keydown', function(e) {
    if (e.which === 13) {
      // Enter accepts selection, focuses next UI element.
      me._confirmSelection();
      $('#add_button').focus();
      return false;
    } else if (e.which === 9) {
      // Tab accepts selection. Browser default behavior focuses next element.
      me._confirmSelection();
      return true;
    } else if (e.which === 27) {
      // Abort selection. Stop propagation to avoid closing the whole
      // popup window.
      e.stopPropagation();
      me.input.blur();
      return false;
    } else if (e.which === 40) {
      // Down: select next.
      var index = me._indexOfSelectedUser();
      if (index === -1 && me.filtered_users.length > 0) {
        me.setSelectedUserId(me.filtered_users[0].gid);
      } else if (index >= 0 && index < me.filtered_users.length) {
        me.setSelectedUserId(me.filtered_users[index + 1].gid);
      }
      me._ensureSelectedUserVisible();
      e.preventDefault();
    } else if (e.which === 38) {
      // Up: select prev.
      var index = me._indexOfSelectedUser();
      if (index > 0) {
        me.setSelectedUserId(me.filtered_users[index - 1].gid);
      }
      me._ensureSelectedUserVisible();
      e.preventDefault();
    }
  });

  // When the input changes value, update and re-render our filtered list.
  me.input.addEventListener('input', function() {
    me._updateUsers();
    me._renderList();
  });

  // A user clicking or tabbing to the label should open the typeahead
  // and select what's already there.
  me.token_area.addEventListener('focus', function() {
    me.input.focus();
    me.input[0].setSelectionRange(0, me.input.value.length);
  });

  me.render();
};

Asana.update(UserTypeahead, {

  SILHOUETTE_URL: './images/nopicture.png',

  /**
   * @param user {dict}
   * @param size {string} small, inbox, etc.
   * @returns {jQuery} photo element
   */
  photoForUser: function(user, size) {
    var photo = document.createElement('div');
    photo.classList.add('Avatar', 'Avatar--' + size);
    var url = user.photo ? user.photo.image_60x60 : UserTypeahead.SILHOUETTE_URL;
    photo.style.backgroundImage = 'url(' + url + ')';
    var photoView = document.createElement('div');
    photoView.classList.add('photo-view', size, 'tokenView-photo');
    photoView.append(photo);
    return photoView;
  }

});

Asana.update(UserTypeahead.prototype, {

  /**
   * Render the typeahead, changing elements and content as needed.
   */
  render: function() {
    var me = this;
    if (this.has_focus) {
      // Focused - show the list and input instead of the label.
      me._renderList();
      me.input.style.display = '';
      me.token.style.display = 'none';
      me.list_container.style.display = '';
    } else {
      // Not focused - show the label, not the list or input.
      me._renderTokenOrPlaceholder();
      me.list_container.style.display = 'none';
    }
  },

  /**
   * Update the set of all (unfiltered) users available in the typeahead.
   *
   * @param users {dict[]}
   */
  updateUsers: function(users) {
    var me = this;
    // Build a map from user ID to user
    var this_user = null;
    var users_without_this_user = [];
    me.user_gid_to_user = {};
    users.forEach(function(user) {
      if (user.gid === Popup.user_gid) {
        this_user = user;
      } else {
        users_without_this_user.push(user);
      }
      me.user_gid_to_user[user.gid] = user;
    });

    // Put current user at the beginning of the list.
    // We really should have found this user, but if not .. let's not crash.
    me.users = this_user ?
        [this_user].concat(users_without_this_user) : users_without_this_user;

    // If selected user is not in this workspace, unselect them.
    if (!(me.selected_user_gid in me.user_gid_to_user)) {
      me.selected_user_gid = null;
      me._updateInput();
    }
    me._updateFilteredUsers();
    me.render();
  },

  _renderTokenOrPlaceholder: function() {
    var me = this;
    var selected_user = me.user_gid_to_user[me.selected_user_gid];
    if (selected_user) {
      me.token.innerHTML = '';
      if (selected_user.photo) {
        me.token.append(UserTypeahead.photoForUser(selected_user, 'small'));
      }
      me.token.innerHTML +=
          '<span class="tokenView-label">' +
          '  <span class="tokenView-labelText">' + selected_user.name + '</span>' +
          '</span>' +
          '<a id = "' + me.gid + '_token_remove" class="tokenView-remove">' +
          '  <svg class="svgIcon tokenView-removeIcon" viewBox="0 0 32 32" title="remove">' +
          '    <polygon points="23.778,5.393 16,13.172 8.222,5.393 5.393,8.222 13.172,16 5.393,23.778 8.222,26.607 16,18.828 23.778,26.607 26.607,23.778 18.828,16 26.607,8.222"></polygon>' +
          '  </svg>' +
          '</a>';
      $('#' + me.gid + '_token_remove').addEventListener('mousedown', function(e) {
        me.selected_user_gid = null;
        me._updateInput();
        me.input.focus();
      });
      me.token.style.display = '';
      me.input.style.display = 'none';
    } else {
      me.token.style.display = 'none';
      me.input.style.display = '';
    }
  },

  _renderList: function() {
    var me = this;
    me.list.innerHTML = '';
    me.filtered_users.forEach(function(user) {
      me.list.append(me._entryForUser(user, user.gid === me.selected_user_gid));
    });
  },

  _entryForUser: function(user, is_selected) {
    var me = this;
    var node = document.createElement('div');
    node.id = 'user_' + user.gid;
    node.classList.add('user');
    node.append(UserTypeahead.photoForUser(user, 'inbox'));
    var userName = document.createElement('div');
    userName.classList.add('user-name');
    userName.textContent = user.name;
    node.append(userName);
    if (is_selected) {
      node.classList.add('selected');
    }

    // Select on mouseover.
    node.addEventListener('mouseenter', function() {
      me.setSelectedUserId(user.gid);
    });

    // Select and confirm on click. We listen to `mousedown` because a click
    // will take focus away from the input, hiding the user list and causing
    // us not to get the ensuing `click` event.
    node.addEventListener('mousedown', function() {
      me.setSelectedUserId(user.gid);
      me._confirmSelection();
    });
    console.log(node);
    return node;
  },

  _confirmSelection: function() {
    this.user_gid_to_select = this.selected_user_gid;
  },

  _updateUsers: function() {
    var me = this;

    this._request_counter += 1;
    var current_request_counter = this._request_counter;
    Asana.ServerModel.userTypeahead(
      Popup.options.default_workspace_gid,
      this.input.value,
      function (users) {
        // Only update the list if no future requests have been initiated.
        if (me._request_counter === current_request_counter) {
          // Update the ID -> User map.
          users.forEach(function (user) {
            me.user_gid_to_user[user.gid] = user;
          });
          // Insert new uers at the end.
          me.filtered_users = users;
          me._renderList();
        }
      });
  },

  _indexOfSelectedUser: function() {
    var me = this;
    var selected_user = me.user_gid_to_user[me.selected_user_gid];
    if (selected_user) {
      return me.filtered_users.indexOf(selected_user);
    } else {
      return -1;
    }
  },

  /**
   * Helper to call this when the selection was changed by something that
   * was not the mouse (which is pointing directly at a visible element),
   * to ensure the selected user is always visible in the list.
   */
  _ensureSelectedUserVisible: function() {
    var index = this._indexOfSelectedUser();
    if (index !== -1) {
      var node = this.list.children()[index];
      Asana.Node.ensureBottomVisible(node);
    }
  },

  _updateInput: function() {
    var me = this;
    var selected_user = me.user_gid_to_user[me.selected_user_gid];
    if (selected_user) {
      me.input.value = selected_user.name;
    } else {
      me.input.value = '';
    }
  },

  setSelectedUserId: function(gid) {
    if (this.selected_user_gid !== null && $('#user_' + this.selected_user_gid)) {
      $('#user_' + this.selected_user_gid).classList.remove('selected');
    }
    this.selected_user_gid = gid;
    if (this.selected_user_gid !== null && $('#user_' + this.selected_user_gid)) {
      $('#user_' + this.selected_user_gid).classList.add('selected');
    }
    this._updateInput();
  }

});


window.addEventListener('load', function() {
  Popup.onLoad();
});
