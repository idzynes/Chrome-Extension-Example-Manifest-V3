/**
 * Load/save options to preferences. Options are represented
 * as a dictionary/object with the following fields:
 *
 *     defaultWorkspaceGid {String} ID of the workspace that tasks should
 *         go into by default. The user will be allowed to choose a
 *         different option when adding a task. This is "0" if no default
 *         workspace is selected and we'll try to use the last used space.
 *     lastUsedWorkspaceGid {String}
 *
 * They are stored off in browser local storage for the extension and set/get
 * async.
 */

var init = function() {
  fillOptions();
  $('#reset_button').addEventListener('click', resetOptions);
};

// Restores select box state to saved value from localStorage.
var fillOptions = function() {
  chrome.storage.sync.get({
    defaultWorkspaceGid: '0',
    lastUsedWorkspaceGid: '0'
  }, function(options) {
    $('#workspaces_group').value = options.defaultWorkspaceGid;
    fillWorkspacesInBackground(options);
  });
};

var fillWorkspacesInBackground = function(options) {
  Asana.ServerModel.workspaces(function(workspaces) {
    $('#workspaces_group').innerHTML = '<li><label><input name="workspace_gid" type="radio" id="workspace_gid-0" key="0"><b>Last used workspace</b></label></li>';
    workspaces.forEach(function(workspace) {
      var workspaceGid = document.createElement('li');
      workspaceGid.innerHTML = '<label><input name="workspace_gid" type="radio" id="workspace_gid-' +
        workspace.gid + '" key="' + workspace.gid + '"/>' + workspace.name + '</label>';
      $('#workspaces_group').append(workspaceGid);
    });
    var default_workspace_element = $('#workspace_gid-' + options.defaultWorkspaceGid);
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
  chrome.storage.sync.set({
    defaultWorkspaceGid: '0'
  }, function() {
    fillOptions();
    setSaveEnabled(false);
  });
};

var saveOptions = function() {
  var default_workspace_input = $('input[name="workspace_gid"]:checked');
  // Somehow we can't directly call default_workspace_input['key']
  chrome.storage.sync.set({
    defaultWorkspaceGid: default_workspace_input.getAttribute('key')
  }, function() {});

  setSaveEnabled(false);
  $('#status').innerHTML = 'Options saved.';
  setTimeout(function() {
    $('#status').innerHTML = '';
  }, 3000);
};
