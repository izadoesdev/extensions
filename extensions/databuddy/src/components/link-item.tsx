import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { deleteLink, fetchLinkClicks } from "../api";
import type { DatePreset, Link } from "../api";
import { fmt } from "../utils";
import { EditLink } from "./edit-link";
import { LinkAnalytics } from "./link-analytics";

export function LinkItem({ link, preset, onMutate }: { link: Link; preset: DatePreset; onMutate: () => void }) {
  const { data, isLoading } = useCachedPromise(fetchLinkClicks, [link.id, preset], { keepPreviousData: true });

  async function handleDelete() {
    if (
      await confirmAlert({
        title: `Delete ${link.name}?`,
        message: `This will permanently remove the short link dbdy.cc/${link.slug}.`,
        primaryAction: { title: "Delete", style: Alert.ActionStyle.Destructive },
      })
    ) {
      const toast = await showToast({ style: Toast.Style.Animated, title: "Deleting link…" });
      try {
        await deleteLink(link.id);
        toast.style = Toast.Style.Success;
        toast.title = "Link deleted";
        onMutate();
      } catch (err) {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to delete link";
        toast.message = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const shortUrl = `https://dbdy.cc/${link.slug}`;

  return (
    <List.Item
      id={link.id}
      icon={Icon.Link}
      title={link.name}
      subtitle={`/${link.slug}`}
      detail={
        <List.Item.Detail
          isLoading={isLoading}
          metadata={
            <List.Item.Detail.Metadata>
              <List.Item.Detail.Metadata.Label
                title="Total Clicks"
                text={data ? { value: fmt(data.total_clicks), color: Color.Blue } : "–"}
                icon={{ source: Icon.Cursor, tintColor: Color.Blue }}
              />
              <List.Item.Detail.Metadata.Separator />
              <List.Item.Detail.Metadata.Label title="Slug" text={`/${link.slug}`} icon={Icon.Tag} />
              <List.Item.Detail.Metadata.Link title="Target" text={link.targetUrl} target={link.targetUrl} />
              <List.Item.Detail.Metadata.Link title="Short URL" text={shortUrl} target={shortUrl} />
              {link.expiresAt && (
                <List.Item.Detail.Metadata.Label
                  title="Expires"
                  text={new Date(link.expiresAt).toLocaleDateString()}
                  icon={Icon.Clock}
                />
              )}
            </List.Item.Detail.Metadata>
          }
        />
      }
      actions={
        <ActionPanel>
          <Action.Push
            title="View Analytics"
            icon={Icon.BarChart}
            target={<LinkAnalytics link={link} preset={preset} />}
          />
          <Action.Push
            title="Edit Link"
            icon={Icon.Pencil}
            target={<EditLink link={link} onUpdate={onMutate} />}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
          />
          <Action.OpenInBrowser title="Open Target URL" url={link.targetUrl} />
          <Action.CopyToClipboard
            title="Copy Short URL"
            content={shortUrl}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          />
          <Action.CopyToClipboard
            title="Copy Target URL"
            content={link.targetUrl}
            shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
          />
          <Action
            title="Delete Link"
            icon={Icon.Trash}
            style={Action.Style.Destructive}
            shortcut={{ modifiers: ["ctrl"], key: "x" }}
            onAction={handleDelete}
          />
        </ActionPanel>
      }
    />
  );
}
