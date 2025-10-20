'use strict';

const { Gtk, Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;

// Initialize translation
function init() {
    ExtensionUtils.initTranslations();
}

// Check GTK version to use appropriate methods
function isGtk4() {
    return Gtk.get_major_version() >= 4;
}

// Build the preferences widget
function buildPrefsWidget() {
    // Get settings
    const settings = Convenience.getSettings();
    
    // Create notebook (tabbed interface)
    const notebook = new Gtk.Notebook({
        margin_top: 5,
        margin_bottom: 5,
        margin_start: 5,
        margin_end: 5
    });
    
    // Add General tab
    notebook.append_page(buildGeneralTab(settings), new Gtk.Label({ label: _('General') }));
    
    // Add Appearance tab
    notebook.append_page(buildAppearanceTab(settings), new Gtk.Label({ label: _('Appearance') }));
    
    // Add Calendar tab
    notebook.append_page(buildCalendarTab(settings), new Gtk.Label({ label: _('Calendars') }));
    
    // Add Services tab
    notebook.append_page(buildServicesTab(settings), new Gtk.Label({ label: _('Services') }));
    
    // Show all tabs
    if (!isGtk4()) {
        notebook.show_all();
    }
    
    return notebook;
}

// Build the General tab
function buildGeneralTab(settings) {
    const page = new Gtk.Grid({
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        column_spacing: 12,
        row_spacing: 12
    });
    
    let row = 0;
    
    // Title
    const title = new Gtk.Label({
        label: '<b>' + _('General Settings') + '</b>',
        halign: Gtk.Align.START,
        use_markup: true
    });
    page.attach(title, 0, row, 2, 1);
    row++;
    
    // Real-time countdown updates
    const realTimeLabel = new Gtk.Label({
        label: _('Real-time countdown updates:'),
        halign: Gtk.Align.START
    });
    page.attach(realTimeLabel, 0, row, 1, 1);
    
    const realTimeSwitch = new Gtk.Switch({
        halign: Gtk.Align.START
    });
    page.attach(realTimeSwitch, 1, row, 1, 1);
    
    // Bind the switch to the real-time-countdown setting
    settings.bind(
        'real-time-countdown',
        realTimeSwitch,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Show current meeting
    const showCurrentLabel = new Gtk.Label({
        label: _('Show current meeting:'),
        halign: Gtk.Align.START
    });
    page.attach(showCurrentLabel, 0, row, 1, 1);
    
    const showCurrentSwitch = new Gtk.Switch({
        halign: Gtk.Align.START
    });
    page.attach(showCurrentSwitch, 1, row, 1, 1);
    
    // Bind the switch to the show-current-meeting setting
    settings.bind(
        'show-current-meeting',
        showCurrentSwitch,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Refresh interval
    const refreshLabel = new Gtk.Label({
        label: _('Refresh interval (seconds):'),
        halign: Gtk.Align.START
    });
    page.attach(refreshLabel, 0, row, 1, 1);
    
    const refreshAdjustment = new Gtk.Adjustment({
        lower: 30,
        upper: 300,
        step_increment: 30
    });
    const refreshSpinButton = new Gtk.SpinButton({
        adjustment: refreshAdjustment,
        numeric: true
    });
    page.attach(refreshSpinButton, 1, row, 1, 1);
    
    // Bind the spin button to the refresh-interval setting
    settings.bind(
        'refresh-interval',
        refreshSpinButton,
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Show past events
    const showPastLabel = new Gtk.Label({
        label: _('Show past events:'),
        halign: Gtk.Align.START
    });
    page.attach(showPastLabel, 0, row, 1, 1);
    
    const showPastSwitch = new Gtk.Switch({
        halign: Gtk.Align.START
    });
    page.attach(showPastSwitch, 1, row, 1, 1);
    
    // Bind the switch to the show-past-events setting
    settings.bind(
        'show-past-events',
        showPastSwitch,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Show end time
    const showEndTimeLabel = new Gtk.Label({
        label: _('Show event end time:'),
        halign: Gtk.Align.START
    });
    page.attach(showEndTimeLabel, 0, row, 1, 1);
    
    const showEndTimeSwitch = new Gtk.Switch({
        halign: Gtk.Align.START
    });
    page.attach(showEndTimeSwitch, 1, row, 1, 1);
    
    // Bind the switch to the show-event-end-time setting
    settings.bind(
        'show-event-end-time',
        showEndTimeSwitch,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // About section
    const aboutLabel = new Gtk.Label({
        label: '<b>' + _('About Chronome') + '</b>',
        halign: Gtk.Align.START,
        margin_top: 20,
        use_markup: true
    });
    page.attach(aboutLabel, 0, row, 2, 1);
    row++;
    
    const versionLabel = new Gtk.Label({
        label: _('Version: 1.0'),
        halign: Gtk.Align.START
    });
    page.attach(versionLabel, 0, row, 2, 1);
    row++;
    
    const descriptionLabel = new Gtk.Label({
        label: _('A GNOME Shell extension to show your upcoming meetings'),
        halign: Gtk.Align.START,
        wrap: true
    });
    page.attach(descriptionLabel, 0, row, 2, 1);
    row++;
    
    return page;
}

// Helper function to create event type toggle handler
function createEventTypeToggleHandler(checkbox, typeName, settings) {
    checkbox.connect('toggled', () => {
        let types = settings.get_strv('event-types');
        if (checkbox.get_active()) {
            if (!types.includes(typeName)) {
                types.push(typeName);
            }
        } else {
            types = types.filter(type => type !== typeName);
        }
        settings.set_strv('event-types', types);
    });
}

// Build the Appearance tab
function buildAppearanceTab(settings) {
    const page = new Gtk.Grid({
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        column_spacing: 12,
        row_spacing: 12
    });
    
    let row = 0;
    
    // Title
    const title = new Gtk.Label({
        label: '<b>' + _('Appearance Settings') + '</b>',
        halign: Gtk.Align.START,
        use_markup: true
    });
    page.attach(title, 0, row, 2, 1);
    row++;
    
    // Display format
    const displayFormatLabel = new Gtk.Label({
        label: _('Display Format:'),
        halign: Gtk.Align.START
    });
    page.attach(displayFormatLabel, 0, row, 1, 1);
    
    const displayFormatCombo = new Gtk.ComboBoxText();
    displayFormatCombo.append('standard', _('Standard (1 hour until Meeting)'));
    displayFormatCombo.append('compact', _('Compact (1 hour → Meeting)'));
    page.attach(displayFormatCombo, 1, row, 1, 1);
    
    // Bind the ComboBoxText to the display-format setting
    settings.bind(
        'display-format',
        displayFormatCombo,
        'active-id',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Time format
    const timeFormatLabel = new Gtk.Label({
        label: _('Time Format:'),
        halign: Gtk.Align.START
    });
    page.attach(timeFormatLabel, 0, row, 1, 1);
    
    const timeFormatCombo = new Gtk.ComboBoxText();
    timeFormatCombo.append('12h', _('12-hour (1:30 PM)'));
    timeFormatCombo.append('24h', _('24-hour (13:30)'));
    page.attach(timeFormatCombo, 1, row, 1, 1);
    
    // Bind the ComboBoxText to the time-format setting
    settings.bind(
        'time-format',
        timeFormatCombo,
        'active-id',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Status bar icon type
    const iconTypeLabel = new Gtk.Label({
        label: _('Status Bar Icon:'),
        halign: Gtk.Align.START
    });
    page.attach(iconTypeLabel, 0, row, 1, 1);
    
    const iconTypeCombo = new Gtk.ComboBoxText();
    iconTypeCombo.append('calendar', _('Calendar Icon'));
    iconTypeCombo.append('meeting-type', _('Meeting Type Icon'));
    iconTypeCombo.append('none', _('No Icon'));
    page.attach(iconTypeCombo, 1, row, 1, 1);
    
    // Bind the ComboBoxText to the status-bar-icon-type setting
    settings.bind(
        'status-bar-icon-type',
        iconTypeCombo,
        'active-id',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Event title length
    const titleLengthLabel = new Gtk.Label({
        label: _('Maximum Event Title Length:'),
        halign: Gtk.Align.START
    });
    page.attach(titleLengthLabel, 0, row, 1, 1);
    
    const titleLengthAdjustment = new Gtk.Adjustment({
        lower: 10,
        upper: 100,
        step_increment: 5
    });
    const titleLengthSpinButton = new Gtk.SpinButton({
        adjustment: titleLengthAdjustment,
        numeric: true
    });
    page.attach(titleLengthSpinButton, 1, row, 1, 1);
    
    // Bind the spin button to the event-title-length setting
    settings.bind(
        'event-title-length',
        titleLengthSpinButton,
        'value',
        Gio.SettingsBindFlags.DEFAULT
    );
    row++;
    
    // Event types section
    const eventTypesLabel = new Gtk.Label({
        label: '<b>' + _('Event Types to Show') + '</b>',
        halign: Gtk.Align.START,
        margin_top: 20,
        use_markup: true
    });
    page.attach(eventTypesLabel, 0, row, 2, 1);
    row++;
    
    // Create a frame for the event types
    const eventTypesFrame = new Gtk.Frame();
    const eventTypesBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        spacing: 10
    });
    
    // Add the box to the frame
    if (isGtk4()) {
        eventTypesFrame.set_child(eventTypesBox);
    } else {
        eventTypesFrame.add(eventTypesBox);
    }
    
    // Get current event types
    const eventTypes = settings.get_strv('event-types');
    
    // All-day events
    const allDayCheck = new Gtk.CheckButton({
        label: _('All-day events'),
        active: eventTypes.includes('all-day')
    });
    
    // Regular events
    const regularCheck = new Gtk.CheckButton({
        label: _('Regular events'),
        active: eventTypes.includes('regular')
    });
    
    // Declined events
    const declinedCheck = new Gtk.CheckButton({
        label: _('Declined events'),
        active: eventTypes.includes('declined')
    });
    
    // Tentative events
    const tentativeCheck = new Gtk.CheckButton({
        label: _('Tentative events'),
        active: eventTypes.includes('tentative')
    });
    
    // Add checkboxes to the box
    if (isGtk4()) {
        eventTypesBox.append(allDayCheck);
        eventTypesBox.append(regularCheck);
        eventTypesBox.append(declinedCheck);
        eventTypesBox.append(tentativeCheck);
    } else {
        eventTypesBox.pack_start(allDayCheck, false, false, 0);
        eventTypesBox.pack_start(regularCheck, false, false, 0);
        eventTypesBox.pack_start(declinedCheck, false, false, 0);
        eventTypesBox.pack_start(tentativeCheck, false, false, 0);
    }
    
    // Connect signals to update the event-types setting
    createEventTypeToggleHandler(allDayCheck, 'all-day', settings);
    createEventTypeToggleHandler(regularCheck, 'regular', settings);
    createEventTypeToggleHandler(declinedCheck, 'declined', settings);
    createEventTypeToggleHandler(tentativeCheck, 'tentative', settings);
    
    page.attach(eventTypesFrame, 0, row, 2, 1);
    
    return page;
}

// Build the Calendar tab
function buildCalendarTab(settings) {
    const page = new Gtk.Grid({
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        column_spacing: 12,
        row_spacing: 12
    });
    
    let row = 0;
    
    // Title
    const title = new Gtk.Label({
        label: '<b>' + _('Calendar Selection') + '</b>',
        halign: Gtk.Align.START,
        use_markup: true
    });
    page.attach(title, 0, row, 2, 1);
    row++;
    
    // Calendar selection help text
    const calendarHelpLabel = new Gtk.Label({
        label: _('Select calendars to show (leave empty to show all):'),
        halign: Gtk.Align.START,
        wrap: true
    });
    page.attach(calendarHelpLabel, 0, row, 2, 1);
    row++;
    
    // Create a scrolled window for the calendar list
    const scrollWindow = new Gtk.ScrolledWindow({
        min_content_height: 200,
        max_content_height: 200,
        hexpand: true,
        vexpand: true
    });
    page.attach(scrollWindow, 0, row, 2, 1);
    
    // Create a list box for the calendars
    const calendarListBox = new Gtk.ListBox();
    if (isGtk4()) {
        scrollWindow.set_child(calendarListBox);
    } else {
        scrollWindow.add(calendarListBox);
    }
    
    // Try to get available calendars
    try {
        const EDataServer = imports.gi.EDataServer;
        const registry = EDataServer.SourceRegistry.new_sync(null);
        const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
        
        // Get the list of enabled calendar IDs from settings
        const enabledCalendars = settings.get_strv('enabled-calendars');
        
        // Add each calendar as a check button
        for (const source of sources) {
            if (!source.get_enabled()) continue;
            
            const sourceUid = source.get_uid();
            const sourceName = source.get_display_name();
            
            const row = new Gtk.ListBoxRow();
            const box = new Gtk.Box({
                orientation: Gtk.Orientation.HORIZONTAL,
                spacing: 12,
                margin_top: 6,
                margin_bottom: 6,
                margin_start: 6,
                margin_end: 6
            });
            
            const checkButton = new Gtk.CheckButton({
                label: sourceName,
                active: enabledCalendars.includes(sourceUid)
            });
            
            // Store the source UID in the widget for reference
            checkButton.sourceUid = sourceUid;
            
            // Connect change signal
            checkButton.connect('toggled', (widget) => {
                const uid = widget.sourceUid;
                const checked = widget.get_active();
                let current = settings.get_strv('enabled-calendars');
                
                if (checked && !current.includes(uid)) {
                    current.push(uid);
                } else if (!checked && current.includes(uid)) {
                    current = current.filter(id => id !== uid);
                }
                
                settings.set_strv('enabled-calendars', current);
            });
            
            // Add the button to the box
            if (isGtk4()) {
                box.append(checkButton);
                row.set_child(box);
                calendarListBox.append(row);
            } else {
                box.pack_start(checkButton, true, true, 0);
                row.add(box);
                calendarListBox.add(row);
            }
        }
    } catch (e) {
        // If we can't load calendars, show an error message
        const errorLabel = new Gtk.Label({
            label: _('Could not load calendars: ') + e.message,
            wrap: true
        });
        const errorRow = new Gtk.ListBoxRow();
        
        if (isGtk4()) {
            errorRow.set_child(errorLabel);
            calendarListBox.append(errorRow);
        } else {
            errorRow.add(errorLabel);
            calendarListBox.add(errorRow);
        }
    }
    
    return page;
}

// Build the Services tab
function buildServicesTab(settings) {
    const page = new Gtk.Grid({
        margin_top: 10,
        margin_bottom: 10,
        margin_start: 10,
        margin_end: 10,
        column_spacing: 12,
        row_spacing: 12
    });
    
    let row = 0;
    
    // Title
    const title = new Gtk.Label({
        label: '<b>' + _('Meeting Services') + '</b>',
        halign: Gtk.Align.START,
        use_markup: true
    });
    page.attach(title, 0, row, 2, 1);
    row++;
    
    // Service configuration help text
    const serviceHelpLabel = new Gtk.Label({
        label: _('Choose how to open links for each meeting service:'),
        halign: Gtk.Align.START,
        wrap: true
    });
    page.attach(serviceHelpLabel, 0, row, 2, 1);
    row++;

    // Note about current limitation
    const noteLabel = new Gtk.Label({
        label: '<i>' + _('Note: Native application support is not yet implemented. All links currently open in the default browser.') + '</i>',
        halign: Gtk.Align.START,
        use_markup: true,
        wrap: true
    });
    page.attach(noteLabel, 0, row, 2, 1);
    row++;
    
    // Get current services configuration
    let servicesConfig = {};
    try {
        servicesConfig = settings.get_value('meeting-services').deep_unpack();
    } catch (e) {
        // Use defaults if setting is not available
        servicesConfig = {
            'Google Meet': 'default',
            'Zoom': 'default',
            'Teams': 'default',
            'Jitsi': 'default'
        };
    }
    
    // Create a list of services
    const services = [
        'Google Meet',
        'Zoom',
        'Microsoft Teams',
        'Jitsi Meet',
        'Webex',
        'GoToMeeting',
        'BlueJeans',
        'Whereby'
    ];
    
    // Create options for each service
    services.forEach(service => {
        const serviceLabel = new Gtk.Label({
            label: service + ':',
            halign: Gtk.Align.START
        });
        page.attach(serviceLabel, 0, row, 1, 1);
        
        const serviceCombo = new Gtk.ComboBoxText();
        serviceCombo.append('default', _('System Default Browser'));
        serviceCombo.append('app', _('Native Application (if available)'));
        
        // Set current value
        const currentValue = servicesConfig[service] || 'default';
        serviceCombo.set_active_id(currentValue);
        
        // Connect to the changed signal
        serviceCombo.connect('changed', () => {
            const newValue = serviceCombo.get_active_id();
            let config = {};
            try {
                config = settings.get_value('meeting-services').deep_unpack();
            } catch (e) {
                config = {};
            }
            
            config[service] = newValue;
            
            // Convert to GVariant and save
            const variant = new GLib.Variant('a{ss}', config);
            settings.set_value('meeting-services', variant);
        });
        
        page.attach(serviceCombo, 1, row, 1, 1);
        row++;
    });
    
    // List of supported meeting services
    const supportedLabel = new Gtk.Label({
        label: '<i>' + _('Chronome can detect meeting links from Google Meet, Zoom, Microsoft Teams, Jitsi, Webex, GoToMeeting, BlueJeans, Whereby, Chime, and more.') + '</i>',
        halign: Gtk.Align.START,
        use_markup: true,
        wrap: true,
        margin_top: 10
    });
    page.attach(supportedLabel, 0, row, 2, 1);
    
    return page;
}