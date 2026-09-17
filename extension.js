import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {ChronomeIndicator} from './ui/indicator.js';
import {DBUS_NAME, DBUS_PATH, DBUS_IFACE_XML} from './lib/dbusInterface.js';

const SERVICE_RESTART_DELAY_SEC = 2;
const SERVICE_RESTART_MAX_DELAY_SEC = 60;
// A child that ran this long counts as healthy, so the backoff starts over.
const SERVICE_HEALTHY_UPTIME_MS = 60000;

export default class ChronomeExtension extends Extension {
    constructor(metadata) {
        super(metadata);
        this._chronomeIndicator = null;
        this._settings = null;
        this._subprocess = null;
        this._proxyCancellable = null;
        this._restartTimeoutId = null;
        this._restartAttempts = 0;
    }

    enable() {
        this._settings = this.getSettings();
        this._restartAttempts = 0;

        this._spawnService();

        this._proxyCancellable = new Gio.Cancellable();
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES | Gio.DBusProxyFlags.DO_NOT_AUTO_START,
            Gio.DBusNodeInfo.new_for_xml(DBUS_IFACE_XML).interfaces[0],
            DBUS_NAME,
            DBUS_PATH,
            DBUS_NAME,
            this._proxyCancellable,
            (source, res) => {
                let proxy;
                try {
                    proxy = Gio.DBusProxy.new_for_bus_finish(res);
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.error(`Chronome: Failed to create D-Bus proxy: ${e.message}`);
                    return;
                }

                this._chronomeIndicator = new ChronomeIndicator(this, this._settings, proxy);
                Main.panel.addToStatusArea('chronome-indicator', this._chronomeIndicator);
                this._chronomeIndicator.startTimer();
                this._chronomeIndicator.fetchInitialData();
            }
        );
    }

    disable() {
        if (this._proxyCancellable) {
            this._proxyCancellable.cancel();
            this._proxyCancellable = null;
        }

        if (this._restartTimeoutId) {
            GLib.Source.remove(this._restartTimeoutId);
            this._restartTimeoutId = null;
        }

        if (this._chronomeIndicator) {
            this._chronomeIndicator.destroy();
            this._chronomeIndicator = null;
        }

        if (this._subprocess) {
            this._subprocess.send_signal(15); // SIGTERM
            this._subprocess = null;
        }

        this._settings = null;
    }

    _spawnService() {
        const servicePath = this.path + '/service.js';
        // STDIN_PIPE: the child reads a pipe owned by this process. The write end
        // closes when the Shell process dies, and _watchParent in service.js treats
        // that EOF as the signal to shut down.
        let subprocess;
        try {
            subprocess = Gio.Subprocess.new(
                ['gjs', '-m', servicePath],
                Gio.SubprocessFlags.STDIN_PIPE
            );
        } catch (e) {
            // Reached from a GLib timeout callback too, where a throw would escape the source.
            console.error(`Chronome: Failed to spawn service: ${e.message}`);
            this._subprocess = null;
            this._scheduleRestart();
            return;
        }

        this._subprocess = subprocess;
        const spawnedAt = Date.now();

        subprocess.wait_async(null, (proc, res) => {
            proc.wait_finish(res);

            // A watcher belonging to a superseded child must not touch current state.
            if (this._subprocess !== subprocess)
                return;

            if (Date.now() - spawnedAt >= SERVICE_HEALTHY_UPTIME_MS)
                this._restartAttempts = 0;

            this._scheduleRestart();
        });
    }

    _scheduleRestart() {
        if (this._restartTimeoutId)
            return;

        const delaySec = Math.min(
            SERVICE_RESTART_DELAY_SEC * (2 ** this._restartAttempts),
            SERVICE_RESTART_MAX_DELAY_SEC
        );
        this._restartAttempts++;

        console.debug(`Chronome: Service process unavailable, restarting in ${delaySec}s...`);
        this._restartTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            delaySec,
            () => {
                this._restartTimeoutId = null;
                this._spawnService();
                return GLib.SOURCE_REMOVE;
            }
        );
    }
}
