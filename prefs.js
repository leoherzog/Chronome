import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import EDataServer from 'gi://EDataServer?version=1.2';

import {deduplicateSources} from './lib/calendarUtils.js';

export default class ChronomePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.add(this._buildGeneralPage(settings));

        window.add(this._buildAppearancePage(settings));

        window.add(this._buildCalendarsPage(settings));
    }

    _addSwitchRows(group, settings, rows) {
        for (const {key, title, subtitle} of rows) {
            const row = new Adw.SwitchRow({title, subtitle});
            settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
            group.add(row);
        }
    }

    _addComboRow(group, settings, {key, title, subtitle, values, labels}) {
        const row = new Adw.ComboRow({title, subtitle, model: Gtk.StringList.new(labels)});
        // Seed before connecting, so seeding does not write the setting back.
        row.set_selected(values.indexOf(settings.get_string(key)));
        row.connect('notify::selected', () => settings.set_string(key, values[row.selected]));
        group.add(row);
    }

    _addSpinRow(group, settings, {key, title, subtitle, lower, upper, step, page}) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: page}),
        });
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        group.add(row);
    }

    _buildGeneralPage(settings) {
        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });

        const settingsGroup = new Adw.PreferencesGroup({
            title: _('Behavior'),
        });

        this._addSwitchRows(settingsGroup, settings, [
            {key: 'real-time-countdown', title: _('Real-time Countdown'), subtitle: _('Update countdown every second')},
            {key: 'show-current-meeting', title: _('Show Current Meeting'), subtitle: _('Display ongoing meetings in the panel')},
        ]);

        this._addSpinRow(settingsGroup, settings, {
            key: 'refresh-interval',
            title: _('Refresh Interval'),
            subtitle: _('How often to fetch calendar data (seconds)'),
            lower: 30, upper: 300, step: 30, page: 60,
        });

        this._addSwitchRows(settingsGroup, settings, [
            {key: 'show-past-events', title: _('Show Past Events'), subtitle: _('Include completed events in the menu')},
            {key: 'show-event-end-time', title: _('Show Event End Time'), subtitle: _('Display end time alongside start time')},
        ]);

        page.add(settingsGroup);

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

        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
        });

        this._addComboRow(displayGroup, settings, {
            key: 'time-format',
            title: _('Time Format'),
            subtitle: _('Clock format for event times'),
            values: ['12h', '24h'],
            labels: [_('12-hour (1:30 PM)'), _('24-hour (13:30)')],
        });

        this._addComboRow(displayGroup, settings, {
            key: 'status-bar-icon-type',
            title: _('Status Bar Icon'),
            subtitle: _('Icon shown next to the event summary'),
            values: ['calendar', 'meeting-type', 'none'],
            labels: [_('Calendar Icon'), _('Meeting Type Icon'), _('No Icon')],
        });

        this._addSpinRow(displayGroup, settings, {
            key: 'event-title-length',
            title: _('Maximum Title Length'),
            subtitle: _('Truncate long event titles'),
            lower: 10, upper: 100, step: 5, page: 10,
        });

        this._addSwitchRows(displayGroup, settings, [
            {key: 'use-calendar-colors', title: _('Use Calendar Colors'), subtitle: _('Show colored border based on calendar')},
        ]);

        page.add(displayGroup);

        const eventTypesGroup = new Adw.PreferencesGroup({
            title: _('Event Types'),
            description: _('Choose which types of events to display'),
        });

        const eventTypes = settings.get_strv('event-types');

        const eventTypeRows = [
            {key: 'all-day', title: _('All-day Events')},
            {key: 'regular', title: _('Regular Events')},
            {key: 'declined', title: _('Declined Events')},
            {key: 'tentative', title: _('Tentative Events')},
        ];

        for (const {key, title} of eventTypeRows) {
            const row = new Adw.SwitchRow({
                title,
                active: eventTypes.includes(key),
            });
            row.connect('notify::active', () => {
                this._toggleStrvMember(settings, 'event-types', key, row.active);
            });
            eventTypesGroup.add(row);
        }

        page.add(eventTypesGroup);

        return page;
    }

    _toggleStrvMember(settings, key, value, enabled) {
        let values = settings.get_strv(key);
        if (enabled && !values.includes(value)) {
            values.push(value);
        } else if (!enabled) {
            values = values.filter(v => v !== value);
        }
        settings.set_strv(key, values);
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

        const loadingRow = new Adw.ActionRow({
            title: _('Loading calendars...'),
        });
        const spinner = new Gtk.Spinner();
        spinner.start();
        loadingRow.add_suffix(spinner);
        calendarsGroup.add(loadingRow);

        page.add(calendarsGroup);

        EDataServer.SourceRegistry.new(null, (obj, res) => {
            // Check if prefs window was closed before callback fired
            if (!calendarsGroup.get_parent()) {
                return;
            }

            calendarsGroup.remove(loadingRow);

            let registry;
            try {
                registry = EDataServer.SourceRegistry.new_finish(res);
            } catch (e) {
                const errorRow = new Adw.ActionRow({
                    title: _('Could not load calendars'),
                    subtitle: e.message,
                    use_markup: false,
                });
                calendarsGroup.add(errorRow);
                return;
            }

            const sources = registry.list_sources(EDataServer.SOURCE_EXTENSION_CALENDAR);
            const enabledCalendars = settings.get_strv('enabled-calendars');

            const enabledSources = sources.filter(s => s.get_enabled());

            const dedupedSources = deduplicateSources(enabledSources, registry);

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

            // Re-adding an account yields new source UIDs; stale ones filter every event out.
            const known = enabledCalendars.filter(uid => registry.ref_source(uid) !== null);
            if (known.length !== enabledCalendars.length) {
                settings.set_strv('enabled-calendars', known);
            }

            for (const source of sortedSources) {
                const sourceUid = source.get_uid();
                const sourceName = source.get_display_name();

                const calendarRow = new Adw.SwitchRow({
                    title: sourceName,
                    active: known.includes(sourceUid),
                    use_markup: false,
                });

                calendarRow.connect('notify::active', () => {
                    this._toggleStrvMember(settings, 'enabled-calendars', sourceUid, calendarRow.active);
                });

                calendarsGroup.add(calendarRow);
            }
        });

        return page;
    }
}
