This is a free, open-source, sample application demonstrating use of the
Asana API. It takes the form of a Chrome Extension that, when installed,
integrates Asana into your web experience in the following ways:

  * Creates a button in your button-bar which, when clicked, pops up a
    QuickAdd window to create a new task associated with the current web page.
    You can click a button to populate the task name with the page title and
    the URL and current selected text in the notes.

  * Installs the special Asana ALT+SHIFT+A keyboard shortcut. When this key
    combo is pressed from any web page, it brings up the same popup.
    This functionality will operate on any window opened after the extension
    is loaded.

See: http://developer.asana.com/

Files of special interest:

  - background.js:
    Handles generic communication with the API.

  - popup.html:
    Source for the popup window, contains the top-level logic which drives
    most of the user-facing functionality.

To install:

  1. Download the code, e.g. `git clone https://github.com/ShunSakurai/Chrome-Extension-Example-Manifest-V3.git`
  2. Navigate chrome to `chrome://extensions`
  3. Check the `Developer mode` toggle
  4. Click on `Load Unpacked Extension...`
  5. Select the folder containing the extension