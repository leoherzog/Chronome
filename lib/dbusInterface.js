// The D-Bus interface shared by extension.js (proxy) and service.js (export).
// Imports nothing, so both processes can load it.

export const DBUS_NAME = 'tech.herzog.Chronome1';
export const DBUS_PATH = '/tech/herzog/Chronome';

export const DBUS_IFACE_XML = `
<node>
  <interface name="${DBUS_NAME}">
    <method name="GetEvents">
      <arg type="s" direction="out" name="json"/>
    </method>
    <method name="Refresh"/>
    <method name="Ping">
      <arg type="b" direction="out" name="alive"/>
    </method>
    <signal name="EventsChanged">
      <arg type="s" name="json"/>
    </signal>
  </interface>
</node>`;
