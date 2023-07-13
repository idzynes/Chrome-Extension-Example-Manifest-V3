var init = function() {
  fillOptions();
  $('#reset_button').addEventListener('click', resetOptions);
};

// Restores select box state to saved value from localStorage.
var fillOptions = function() {
  var options = Asana.Options.loadOptions();
  $('#asana_host_port_input').value = options.asana_host_port;
  fillDomainsInBackground(options);
};

var fillDomainsInBackground = function(opt_options) {
  var options = opt_options || Asana.Options.loadOptions();
  Asana.ServerModel.workspaces(function(workspaces) {
    $('#domains_group').innerHTML = '';
    workspaces.forEach(function(domain) {
      var defaultDomainGid = document.createElement('label');
      defaultDomainGid.innerHTML = '<input name="default_domain_gid" type="radio" id="default_domain_gid-' +
        domain.gid + '" key="' + domain.gid + '"/>' + domain.name;
      $('#domains_group').append(defaultDomainGid);
    });
    var default_domain_element = $('#default_domain_gid-' + options.default_domain_gid);
    if (default_domain_element) {
      default_domain_element.checked = true;
    } else {
      $('#domains_group input').checked = true;
    }
    $$('#domains_group input').forEach(input => input.addEventListener('change', onChange));
  }, function(error_response) {
    $('#domains_group').innerHTML =
        '<div>Error loading workspaces. Verify the following:<ul>' +
            '<li>Asana Host is configured correctly.</li>' +
            '<li>You are <a target="_blank" href="' +
            Asana.Options.loginUrl() +
            '">logged in</a>.</li>' +
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
  var asana_host_port = $('#asana_host_port_input').value;
  var default_domain_input = $('input[@name="default_domain_gid"]:checked');
  Asana.Options.saveOptions({
    asana_host_port: asana_host_port,
    default_domain_gid: default_domain_input
        ? default_domain_input.key
        : 0
  });
  setSaveEnabled(false);
  $('#status').innerHTML = 'Options saved.';
  setTimeout(function() {
    $('#status').innerHTML = '';
  }, 3000);

  fillDomainsInBackground();
};
