import { Action, ActionPanel, Icon, List, openExtensionPreferences } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { DASHBOARD_URL, fetchFlags } from "./api";
import { FlagItem } from "./components/flags/flag-item";

export default function Command() {
  const { data: flags, isLoading, error, revalidate } = useCachedPromise(fetchFlags);

  if (error) {
    const isAuth = error.message.includes("Invalid API key");
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title={isAuth ? "Invalid API Key" : "Failed to Load Flags"}
          description={isAuth ? "Check your API key in extension preferences." : error.message}
          actions={
            <ActionPanel>
              {isAuth && <Action title="Open Preferences" icon={Icon.Gear} onAction={openExtensionPreferences} />}
              <Action title="Retry" icon={Icon.ArrowClockwise} onAction={revalidate} />
            </ActionPanel>
          }
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} isShowingDetail searchBarPlaceholder="Search flags...">
      {flags?.length === 0 && (
        <List.EmptyView
          icon={Icon.LightBulb}
          title="No Feature Flags"
          description="Create a feature flag to start managing rollouts."
          actions={
            <ActionPanel>
              <Action.OpenInBrowser title="Create in Dashboard" url={DASHBOARD_URL} icon={Icon.Plus} />
            </ActionPanel>
          }
        />
      )}
      {flags?.map((flag) => (
        <FlagItem key={flag.id} flag={flag} onMutate={revalidate} />
      ))}
    </List>
  );
}
