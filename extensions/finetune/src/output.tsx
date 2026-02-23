import {
  Action,
  ActionPanel,
  Form,
  getPreferenceValues,
  Icon,
  Image,
  List,
  showHUD,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { usePromise } from "@raycast/utils";
import {
  getRunningApps,
  isFineTuneInstalled,
  type RunningApp,
} from "./lib/apps";
import { getOutputDevices, type OutputDevice } from "./lib/devices";
import {
  getFineTuneDeviceSettings,
  getFineTuneVolumeState,
} from "./lib/finetune-settings";
import {
  reset,
  setDevice,
  setVolume,
  stepVolume,
  toggleMute,
} from "./lib/finetune";
import { setDeviceVolume } from "./lib/devices";

const BARS = 10;

/** Pick an icon for an output device based on name/UID (we don't have transport type from CLI). */
function getDeviceIcon(device: OutputDevice): Image.ImageLike {
  const name = device.name.toLowerCase();
  const uid = device.uid.toLowerCase();
  if (
    name.includes("studio display") ||
    name.includes("pro display") ||
    name.includes("lg ultrafine") ||
    uid.includes("studiodisplay") ||
    (uid.includes("display") && uid.includes("apple"))
  ) {
    return Icon.Monitor;
  }
  if (name.includes("airpods") || uid.includes("airpods")) {
    return Icon.Airpods;
  }
  if (
    name.includes("earpods") ||
    name.includes("beats") ||
    name.includes("headphones") ||
    name.includes("headset") ||
    uid.includes("bluetooth")
  ) {
    return Icon.Headphones;
  }
  if (
    name.includes("built-in") ||
    name.includes("builtin") ||
    name.includes("macbook") ||
    name.includes("internal") ||
    uid.includes("builtin")
  ) {
    return Icon.Speaker;
  }
  return Icon.Speaker;
}

function volumeAccessories(percent: number): { text: string }[] {
  const filled = Math.min(BARS, Math.round(percent / 10));
  const bar = "▮".repeat(filled) + "▯".repeat(BARS - filled);
  return [{ text: `${percent}% ${bar}` }];
}

/** Parse "Device Name=UID" lines into { "Device Name": "UID" }. Splits on first "=". */
function parseDeviceUIDOverrides(
  raw: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw?.trim()) return out;
  for (const line of raw.trim().split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const name = line.slice(0, eq).trim();
    const uid = line.slice(eq + 1).trim();
    if (name && uid) out[name] = uid;
  }
  return out;
}

function VolumeForm({
  app,
  currentVolume,
  onSuccess,
}: {
  app: RunningApp;
  currentVolume: number;
  onSuccess?: (volume: number) => void;
}) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { volume: string }) {
    const raw = values.volume.trim();
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid volume",
        message: "Enter a number between 0 and 100",
      });
      return;
    }
    try {
      await setVolume(app.bundleId, n);
      await showHUD(`${app.name} → ${n}%`);
      onSuccess?.(n);
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to set volume",
        message:
          err instanceof Error ? err.message : "FineTune may not be installed.",
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Volume" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="volume"
        title="Volume"
        placeholder="0–100"
        defaultValue={String(currentVolume)}
      />
    </Form>
  );
}

function DeviceVolumeForm({
  device,
  currentVolume,
  onSuccess,
}: {
  device: OutputDevice;
  currentVolume: number;
  onSuccess?: (volume: number) => void;
}) {
  const { pop } = useNavigation();

  async function handleSubmit(values: { volume: string }) {
    const raw = values.volume.trim();
    const n = parseInt(raw, 10);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Invalid volume",
        message: "Enter a number between 0 and 100",
      });
      return;
    }
    try {
      await setDeviceVolume(device.uid, n);
      await showHUD(`${device.name} → ${n}%`);
      onSuccess?.(n);
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to set volume",
        message:
          err instanceof Error
            ? err.message
            : "Device may not support volume control.",
      });
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Set Volume" onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="volume"
        title="Volume"
        placeholder="0–100"
        defaultValue={String(currentVolume)}
      />
    </Form>
  );
}

function AppActions({
  app,
  push,
  devices,
  defaultDeviceUID,
  getResolvedUID,
  currentVolume,
  currentMuted,
  updateAppState,
}: {
  app: RunningApp;
  push: (view: React.ReactNode) => void;
  devices: OutputDevice[];
  defaultDeviceUID: string;
  getResolvedUID: (dev: OutputDevice) => string;
  currentVolume: number;
  currentMuted: boolean;
  updateAppState: (
    bundleId: string,
    patch: { volume?: number; muted?: boolean },
  ) => void;
}) {
  const run = async (
    fn: () => Promise<void>,
    success: string,
    failure: string,
    statePatch?: { volume?: number; muted?: boolean },
    keepOpen?: boolean,
  ) => {
    try {
      await fn();
      if (!keepOpen) {
        await showHUD(success);
      }
      if (statePatch) {
        updateAppState(app.bundleId, statePatch);
      }
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: failure,
        message:
          err instanceof Error ? err.message : "FineTune may not be installed.",
      });
    }
  };

  const VOLUME_PRESETS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

  return (
    <ActionPanel>
      <ActionPanel.Submenu title="Set Volume" icon="speaker-on-16">
        {VOLUME_PRESETS.map((pct) => (
          <Action
            key={pct}
            title={`${pct}%`}
            onAction={() =>
              run(
                () => setVolume(app.bundleId, pct),
                `${app.name} → ${pct}%`,
                "Failed to set volume",
                { volume: pct, muted: false },
              )
            }
          />
        ))}
        <Action
          title="Custom…"
          onAction={() =>
            push(
              <VolumeForm
                app={app}
                currentVolume={currentVolume}
                onSuccess={(vol) =>
                  updateAppState(app.bundleId, { volume: vol, muted: false })
                }
              />,
            )
          }
        />
      </ActionPanel.Submenu>
      <Action
        title="Volume up"
        icon="arrow-up-16"
        onAction={() =>
          run(
            () => stepVolume(app.bundleId, "up"),
            `${app.name} volume up`,
            "Failed to step volume",
            { volume: Math.min(100, currentVolume + 10) },
            true,
          )
        }
        shortcut={{ modifiers: ["cmd"], key: "arrowRight" }}
      />
      <Action
        title="Volume Down"
        icon="arrow-down-16"
        onAction={() =>
          run(
            () => stepVolume(app.bundleId, "down"),
            `${app.name} volume down`,
            "Failed to step volume",
            { volume: Math.max(0, currentVolume - 10) },
            true,
          )
        }
        shortcut={{ modifiers: ["cmd"], key: "arrowLeft" }}
      />
      <Action
        title="Toggle Mute"
        icon="speaker-off-16"
        onAction={() =>
          run(
            () => toggleMute([app.bundleId]),
            `Toggled mute: ${app.name}`,
            "Failed to toggle mute",
            { muted: !currentMuted },
          )
        }
      />
      <Action
        title="Reset to 100%"
        icon="arrow-counter-clockwise-16"
        onAction={() =>
          run(
            () => reset([app.bundleId]),
            `Reset ${app.name} to 100%`,
            "Failed to reset",
            { volume: 100, muted: false },
          )
        }
      />
      {devices.length > 0 ? (
        <ActionPanel.Submenu title="Route to Device" icon="speaker-16">
          {defaultDeviceUID &&
            devices.some((d) => getResolvedUID(d) === defaultDeviceUID) && (
              <Action
                title="Default Device"
                onAction={() =>
                  run(
                    () => setDevice(app.bundleId, defaultDeviceUID),
                    `Routed ${app.name} to default device`,
                    "Failed to set device",
                  )
                }
              />
            )}
          {devices.map((dev) => {
            const uid = getResolvedUID(dev);
            return (
              <Action
                key={dev.uid}
                title={dev.name}
                icon={getDeviceIcon(dev)}
                onAction={() =>
                  run(
                    () => setDevice(app.bundleId, uid),
                    `Routed ${app.name} to ${dev.name}`,
                    "Failed to set device",
                  )
                }
              />
            );
          })}
        </ActionPanel.Submenu>
      ) : null}
    </ActionPanel>
  );
}

export default function OutputCommand() {
  const { push } = useNavigation();
  const prefs = getPreferenceValues();
  const deviceUID = (prefs.defaultDeviceUID ?? "").trim();
  const deviceUIDOverrides = useMemo(
    () => parseDeviceUIDOverrides(prefs.deviceUIDOverrides),
    [prefs.deviceUIDOverrides],
  );

  const { isLoading, data, error, revalidate } = usePromise(async () => {
    const [apps, volumeState, devices, deviceSettings, fineTuneInstalled] =
      await Promise.all([
        getRunningApps(),
        getFineTuneVolumeState(),
        getOutputDevices(true),
        getFineTuneDeviceSettings(),
        isFineTuneInstalled(),
      ]);
    return {
      apps,
      volumeState,
      devices,
      deviceSettings,
      fineTuneInstalled,
    };
  });

  // Refresh list periodically so closed apps disappear
  useEffect(() => {
    const interval = setInterval(revalidate, 5000);
    return () => clearInterval(interval);
  }, [revalidate]);
  const rawApps = data?.apps ?? [];
  const volumeState = data?.volumeState ?? {};
  const devices = data?.devices ?? [];
  const deviceSettings = data?.deviceSettings ?? {
    deviceVolumes: {},
    outputDevicePriority: [],
    deviceUIDsInUse: [],
  };
  const fineTuneInstalled = data?.fineTuneInstalled ?? false;

  /** Resolved UID per device: override, or FineTune "orphan" when 1:1 mismatch (e.g. Studio Display), or CLI uid. */
  const getResolvedUID = useMemo(() => {
    const overrides = deviceUIDOverrides;
    const ourUIDs = new Set(devices.map((d) => d.uid));
    const fineTuneUIDs = new Set(deviceSettings.deviceUIDsInUse ?? []);
    const orphans = [...fineTuneUIDs].filter((u) => !ourUIDs.has(u));
    const unmatched = devices.filter((d) => !fineTuneUIDs.has(d.uid));
    const useOrphan =
      orphans.length === 1 && unmatched.length === 1
        ? { deviceName: unmatched[0].name, uid: orphans[0] }
        : null;
    return (dev: OutputDevice): string =>
      overrides[dev.name] ??
      (useOrphan && dev.name === useOrphan.deviceName
        ? useOrphan.uid
        : dev.uid);
  }, [devices, deviceSettings.deviceUIDsInUse, deviceUIDOverrides]);

  const apps = useMemo(
    () =>
      [...rawApps].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      ),
    [rawApps],
  );

  const [localOverrides, setLocalOverrides] = useState<
    Record<string, { volume: number; muted: boolean }>
  >({});
  const [deviceVolumeOverrides, setDeviceVolumeOverrides] = useState<
    Record<string, number>
  >({});

  function updateAppState(
    bundleId: string,
    patch: { volume?: number; muted?: boolean },
  ) {
    setLocalOverrides((prev) => {
      const prevState = prev[bundleId];
      const base = {
        volume: prevState?.volume ?? 100,
        muted: prevState?.muted ?? false,
        ...patch,
      };
      return { ...prev, [bundleId]: base };
    });
  }

  if (error) {
    return (
      <List>
        <List.EmptyView
          title="Could not load apps"
          description={error.message}
        />
      </List>
    );
  }

  if (!isLoading && !fineTuneInstalled) {
    return (
      <List navigationTitle="Output Devices">
        <List.EmptyView
          icon={Icon.Warning}
          title="FineTune is required"
          description="Install the FineTune app to control per-app volume and devices from Raycast. Install via Homebrew or download from GitHub."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser
                title="Open FineTune on GitHub"
                url="https://github.com/ronitsingh10/FineTune"
              />
              <Action.OpenInBrowser
                title="Install with Homebrew"
                url="https://formulae.brew.sh/cask/finetune"
              />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List
      isLoading={isLoading}
      searchBarPlaceholder="Search apps and devices"
      navigationTitle="Output Devices"
    >
      {devices.length > 0 ? (
        <List.Section title="Devices">
          {devices.map((dev) => {
            const savedState = deviceSettings.deviceVolumes[dev.uid];
            const liveVolume = dev.volume;
            const overrideVolume = deviceVolumeOverrides[dev.uid];
            const volume =
              overrideVolume ?? liveVolume ?? savedState?.volume ?? 100;
            const hasKnownVolume =
              overrideVolume !== undefined ||
              liveVolume !== undefined ||
              savedState !== undefined;
            const muted = savedState?.muted ?? false;
            const subtitle = muted ? "Muted" : "";
            const accessories = hasKnownVolume
              ? volumeAccessories(volume)
              : [{ text: "Not set" }];
            const VOLUME_PRESETS = [
              0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
            ] as const;
            return (
              <List.Item
                key={dev.uid}
                title={dev.name}
                subtitle={subtitle}
                icon={getDeviceIcon(dev)}
                accessories={accessories}
                keywords={[dev.name, dev.uid]}
                actions={
                  <ActionPanel>
                    <ActionPanel.Submenu
                      title="Set Volume"
                      icon={Icon.SpeakerOn}
                    >
                      {VOLUME_PRESETS.map((pct) => (
                        <Action
                          key={pct}
                          title={`${pct}%`}
                          onAction={async () => {
                            try {
                              await setDeviceVolume(dev.uid, pct);
                              await showHUD(`${dev.name} → ${pct}%`);
                              setDeviceVolumeOverrides((prev) => ({
                                ...prev,
                                [dev.uid]: pct,
                              }));
                            } catch (err) {
                              await showToast({
                                style: Toast.Style.Failure,
                                title: "Failed to set volume",
                                message:
                                  err instanceof Error
                                    ? err.message
                                    : "Device may not support volume control.",
                              });
                            }
                          }}
                        />
                      ))}
                      <Action
                        title="Custom…"
                        onAction={() =>
                          push(
                            <DeviceVolumeForm
                              device={dev}
                              currentVolume={volume}
                              onSuccess={(vol) => {
                                setDeviceVolumeOverrides((prev) => ({
                                  ...prev,
                                  [dev.uid]: vol,
                                }));
                              }}
                            />,
                          )
                        }
                      />
                    </ActionPanel.Submenu>
                    <Action
                      title="Volume up"
                      icon="arrow-up-16"
                      onAction={async () => {
                        const next = Math.min(100, volume + 10);
                        try {
                          await setDeviceVolume(dev.uid, next);
                          setDeviceVolumeOverrides((prev) => ({
                            ...prev,
                            [dev.uid]: next,
                          }));
                        } catch (err) {
                          await showToast({
                            style: Toast.Style.Failure,
                            title: "Failed to set volume",
                            message:
                              err instanceof Error
                                ? err.message
                                : "Device may not support volume control.",
                          });
                        }
                      }}
                      shortcut={{ modifiers: ["cmd"], key: "arrowRight" }}
                    />
                    <Action
                      title="Volume Down"
                      icon="arrow-down-16"
                      onAction={async () => {
                        const next = Math.max(0, volume - 10);
                        try {
                          await setDeviceVolume(dev.uid, next);
                          setDeviceVolumeOverrides((prev) => ({
                            ...prev,
                            [dev.uid]: next,
                          }));
                        } catch (err) {
                          await showToast({
                            style: Toast.Style.Failure,
                            title: "Failed to set volume",
                            message:
                              err instanceof Error
                                ? err.message
                                : "Device may not support volume control.",
                          });
                        }
                      }}
                      shortcut={{ modifiers: ["cmd"], key: "arrowLeft" }}
                    />
                  </ActionPanel>
                }
              />
            );
          })}
        </List.Section>
      ) : null}
      {apps?.length ? (
        <List.Section title="Apps">
          {apps.map((app) => {
            const fromDisk = volumeState[app.bundleId];
            const local = localOverrides[app.bundleId];
            const volumePercent = local?.volume ?? fromDisk?.volume ?? 100;
            const muted = local?.muted ?? fromDisk?.muted ?? false;
            const subtitle = muted ? "Muted" : "";
            const listIcon = app.appPath
              ? { fileIcon: app.appPath }
              : Icon.Speaker;
            return (
              <List.Item
                key={app.bundleId}
                title={app.name}
                subtitle={subtitle}
                icon={listIcon}
                accessories={volumeAccessories(volumePercent)}
                keywords={[app.bundleId]}
                actions={
                  <AppActions
                    app={app}
                    push={push}
                    devices={devices}
                    defaultDeviceUID={deviceUID}
                    getResolvedUID={getResolvedUID}
                    currentVolume={volumePercent}
                    currentMuted={muted}
                    updateAppState={updateAppState}
                  />
                }
              />
            );
          })}
        </List.Section>
      ) : (
        !isLoading &&
        devices.length === 0 && (
          <List.EmptyView
            title="No running apps"
            description="Start an app to control its volume."
          />
        )
      )}
    </List>
  );
}
