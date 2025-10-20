'use strict';

const { Gio, GLib } = imports.gi;
const ExtensionUtils = imports.misc.extensionUtils;
const Me = ExtensionUtils.getCurrentExtension();

/**
 * Utility function to get the extension's settings
 * @returns {Gio.Settings} The extension's settings object
 */
function getSettings() {
    let gschemaDir = Me.dir.get_child('schemas');
    let schemaSource;
    
    if (gschemaDir.query_exists(null)) {
        schemaSource = Gio.SettingsSchemaSource.new_from_directory(
            gschemaDir.get_path(),
            Gio.SettingsSchemaSource.get_default(),
            false
        );
    } else {
        schemaSource = Gio.SettingsSchemaSource.get_default();
    }
    
    let schemaObj = schemaSource.lookup(
        'org.gnome.shell.extensions.chronome', true);
        
    if (!schemaObj) {
        throw new Error('Schema org.gnome.shell.extensions.chronome not found');
    }
    
    return new Gio.Settings({ settings_schema: schemaObj });
}

