/**
 * External dependencies.
 */
import { Button, Card, CardContent, Typography, useToast } from "@next-pms/design-system/components";
import { useFrappePostCall } from "frappe-react-sdk";
import { Copy, RefreshCw, Rss } from "lucide-react";

/**
 * Internal dependencies.
 */
import { copyToClipboard, parseFrappeErrorMsg } from "@/lib/utils";
import type { CalendarFeedSettings } from "../types";

export const CalendarFeedCard = ({
  settings,
  onRefresh,
}: {
  settings: CalendarFeedSettings;
  onRefresh: () => void;
}) => {
  const { toast } = useToast();
  const { call: regenerateToken, loading } = useFrappePostCall(
    "next_pms.resource_management.api.personal.regenerate_calendar_feed_token"
  );

  const copyFeed = (url: string, label: string) => {
    copyToClipboard(url);
    toast({ variant: "success", description: `${label} copied to clipboard.` });
  };

  const handleRegenerate = () => {
    regenerateToken({})
      .then(() => {
        onRefresh();
        toast({ variant: "success", description: "Calendar feed link regenerated." });
      })
      .catch((error) => {
        toast({ variant: "destructive", description: parseFrappeErrorMsg(error) });
      });
  };

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <Rss className="h-5 w-5 mt-0.5 text-primary shrink-0" />
          <div className="min-w-0 space-y-1">
            <Typography variant="p" className="font-medium">
              Sync to Personal Calendar
            </Typography>
            <Typography variant="small" className="text-muted-foreground">
              Subscribe with Google Calendar, Outlook, or Apple Calendar using the ICS feed below.
              The feed is read-only.
            </Typography>
          </div>
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <Typography variant="small" className="break-all text-muted-foreground">
            {settings.feed_url}
          </Typography>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => copyFeed(settings.feed_url, "ICS feed URL")}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy ICS URL
          </Button>
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => copyFeed(settings.webcal_url, "Webcal URL")}
          >
            <Copy className="h-4 w-4 mr-2" />
            Copy Webcal URL
          </Button>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={handleRegenerate}
            disabled={loading}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Regenerate Link
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
