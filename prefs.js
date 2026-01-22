import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import EDataServer from 'gi://EDataServer?version=1.2';

import {deduplicateSources} from './lib/calendarUtils.js';

export default class ChronomePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        // Add General page
        window.add(this._buildGeneralPage(settings));

        // Add Appearance page
        window.add(this._buildAppearancePage(settings));

        // Add Calendars page
        window.add(this._buildCalendarsPage(settings));
    }

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        // Settings group
        const settingsGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
        });

        // Real-time countdown
        const realTimeRow = new Adw.SwitchRow({
            title: _('Real-time Countdown'),
            subtitle: _('Update countdown every second'),
        });
        settings.bind('real-time-countdown', realTimeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(realTimeRow);

        // Show current meeting
        const showCurrentRow = new Adw.SwitchRow({
            title: _('Show Current Meeting'),
            subtitle: _('Display ongoing meetings in the panel'),
        });
        settings.bind('show-current-meeting', showCurrentRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(showCurrentRow);

        // Refresh interval
        const refreshRow = new Adw.SpinRow({
            title: _('Refresh Interval'),
            subtitle: _('How often to fetch calendar data (seconds)'),
            adjustment: new Gtk.Adjustment({
                lower: 30,
                upper: 300,
                step_increment: 30,
                page_increment: 60,
            }),
        });
        settings.bind('refresh-interval', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(refreshRow);

        // Show past events
        const showPastRow = new Adw.SwitchRow({
            title: _('Show Past Events'),
            subtitle: _('Include completed events in the menu'),
        });
        settings.bind('show-past-events', showPastRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(showPastRow);

        // Show event end time
        const showEndTimeRow = new Adw.SwitchRow({
            title: _('Show Event End Time'),
            subtitle: _('Display end time alongside start time'),
        });
        settings.bind('show-event-end-time', showEndTimeRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        settingsGroup.add(showEndTimeRow);

        page.add(settingsGroup);

        // About group
        const aboutGroup = new Adw.PreferencesGroup({
            title: _('About'),
        });

        const aboutRow = new Adw.ActionRow({
            title: _('Chronome'),
            subtitle: _('A GNOME Shell extension to show your upcoming meetings'),
        });
        aboutRow.add_prefix(new Gtk.Image({
            icon_name: 'x-office-calendar-symbolic',
            pixel_size: 32,
        }));
        aboutGroup.add(aboutRow);

        page.add(aboutGroup);

        return page;
    }

    _buildAppearancePage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Appearance'),
            icon_name: 'applications-graphics-symbolic',
        });

        // Display group
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
        });

        // Time format
        const timeFormatModel = new Gtk.StringList();
        timeFormatModel.append(_('12-hour (1:30 PM)'));
        timeFormatModel.append(_('24-hour (13:30)'));

        const timeFormatRow = new Adw.ComboRow({
            title: _('Time Format'),
            subtitle: _('Clock format for event times'),
            model: timeFormatModel,
        });

        const timeValue = settings.get_string('time-format');
        timeFormatRow.set_selected(timeValue === '24h' ? 1 : 0);

        timeFormatRow.connect('notify::selected', () => {
            settings.set_string('time-format', timeFormatRow.selected === 1 ? '24h' : '12h');
        });
        displayGroup.add(timeFormatRow);

        // Status bar icon
        const iconTypeModel = new Gtk.StringList();
        iconTypeModel.append(_('Calendar Icon'));
        iconTypeModel.append(_('Meeting Type Icon'));
        iconTypeModel.append(_('No Icon'));

        const iconTypeRow = new Adw.ComboRow({
            title: _('Status Bar Icon'),
            subtitle: _('Icon shown next to the event summary'),
            model: iconTypeModel,
        });

        const iconValue = settings.get_string('status-bar-icon-type');
        const iconMap = {'calendar': 0, 'meeting-type': 1, 'none': 2};
        iconTypeRow.set_selected(iconMap[iconValue] ?? 0);

        iconTypeRow.connect('notify::selected', () => {
            const values = ['calendar', 'meeting-type', 'none'];
            settings.set_string('status-bar-icon-type', values[iconTypeRow.selected]);
        });
        displayGroup.add(iconTypeRow);

        // Event title length
        const titleLengthRow = new Adw.SpinRow({
            title: _('Maximum Title Length'),
            subtitle: _('Truncate long event titles'),
            adjustment: new Gtk.Adjustment({
                lower: 10,
                upper: 100,
                step_increment: 5,
                page_increment: 10,
            }),
        });
        settings.bind('event-title-length', titleLengthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(titleLengthRow);

        // Use calendar colors
        const calendarColorsRow = new Adw.SwitchRow({
            title: _('Use Calendar Colors'),
            subtitle: _('Show colored border based on calendar'),
        });
        settings.bind('use-calendar-colors', calendarColorsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(calendarColorsRow);

        page.add(displayGroup);

        // Event types group
        const eventTypesGroup = new Adw.PreferencesGroup({
            title: _('Event Types'),
            description: _('Choose which types of events to display'),
        });

        const eventTypes = settings.get_strv('event-types');

        // All-day events
        const allDayRow = new Adw.SwitchRow({
            title: _('All-day Events'),
            active: eventTypes.includes('all-day'),
        });
        allDayRow.connect('notify::active', () => {
            this._updateEventTypes(settings, 'all-day', allDayRow.active);
        });
        eventTypesGroup.add(allDayRow);

        // Regular events
        const regularRow = new Adw.SwitchRow({
            title: _('Regular Events'),
            active: eventTypes.includes('regular'),
        });
        regularRow.connect('notify::active', () => {
            this._updateEventTypes(settings, 'regular', regularRow.active);
        });
        eventTypesGroup.add(regularRow);

        // Declined events
        const declinedRow = new Adw.SwitchRow({
            title: _('Declined Events'),
            active: eventTypes.includes('declined'),
        });
        declinedRow.connect('notify::active', () => {
            this._updateEventTypes(settings, 'declined', declinedRow.active);
        });
        eventTypesGroup.add(declinedRow);

        // Tentative events
        const tentativeRow = new Adw.SwitchRow({
            title: _('Tentative Events'),
            active: eventTypes.includes('tentative'),
        });
        tentativeRow.connect('notify::active', () => {
            this._updateEventTypes(settings, 'tentative', tentativeRow.active);
        });
        eventTypesGroup.add(tentativeRow);

        page.add(eventTypesGroup);

        return page;
    }

    _updateEventTypes(settings, eventType, enabled) {
        let types = settings.get_strv('event-types');
        if (enabled && !types.includes(eventType)) {
            types.push(eventType);
        } else if (!enabled) {
            types = types.filter(t => t !== eventType);
        }
        settings.set_strv('event-types', types);
    }

    _buildCalendarsPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('Calendars'),
            icon_name: 'x-office-calendar-symbolic',
        });

        const calendarsGroup = new Adw.PreferencesGroup({
            title: _('Calendar Selection'),
            description: _('Select which calendars to show. Leave all unchecked to show all calendars.'),
        });

        // Add loading indicator
        const loadingRow = new Adw.ActionRow({
            title: _('Loading calendars...'),
        });
        const spinner = new Gtk.Spinner({ visible: true });
        spinner.start();
        loadingRow.add_suffix(spinner);
        calendarsGroup.add(loadingRow);

        page.add(calendarsGroup);

        // Load registry asynchronously
        EDataServer.SourceRegistry.new(null, (obj, res) => {
            try {
                // Check if prefs window was closed before callback fired
                if (!calendarsGroup.get_parent()) {
                    return;
                }

                // Remove loading indicator
                calendarsGroup.remove(loadingRow);

                const registry = EDataServer.SourceRegistry.new_finish(res);
                const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
                const enabledCalendars = settings.get_strv('enabled-calendars');

                // Filter to enabled sources
                const enabledSources = sources.filter(s => s.get_enabled());

                // Deduplicate sources by calendar ID (keeps owner's version for shared calendars)
                const dedupedSources = deduplicateSources(enabledSources, registry);

                // Sort by display name
                const sortedSources = dedupedSources.sort((a, b) =>
                    a.get_display_name().localeCompare(b.get_display_name()));

                if (sortedSources.length === 0) {
                    const noCalendarsRow = new Adw.ActionRow({
                        title: _('No calendars found'),
                        subtitle: _('Add calendars in GNOME Online Accounts'),
                    });
                    calendarsGroup.add(noCalendarsRow);
                    return;
                }

                for (const source of sortedSources) {
                    const sourceUid = source.get_uid();
                    const sourceName = source.get_display_name();

                    const calendarRow = new Adw.SwitchRow({
                        title: sourceName,
                        active: enabledCalendars.includes(sourceUid),
                        use_markup: false,
                    });

                    calendarRow.connect('notify::active', () => {
                        let current = settings.get_strv('enabled-calendars');
                        if (calendarRow.active && !current.includes(sourceUid)) {
                            current.push(sourceUid);
                        } else if (!calendarRow.active) {
                            current = current.filter(id => id !== sourceUid);
                        }
                        settings.set_strv('enabled-calendars', current);
                    });

                    calendarsGroup.add(calendarRow);
                }
            } catch (e) {
                // Remove loading indicator if it exists
                try {
                    calendarsGroup.remove(loadingRow);
                } catch (err) { /* ignore */ }

                const errorRow = new Adw.ActionRow({
                    title: _('Could not load calendars'),
                    subtitle: e.message,
                });
                calendarsGroup.add(errorRow);
            }
        });

        return page;
    }
}
