/**
 * External dependencies
 */
import { Typography } from "@next-pms/design-system/components";
import { mergeClassNames } from "@next-pms/design-system/utils";
/**
 * Internal dependencies
 */
import { renderMarkdownToHtml } from "@/lib/renderMarkdown";

type MarkdownContentProps = {
  value?: string | null;
  className?: string;
};

export const MarkdownContent = ({ value, className }: MarkdownContentProps) => {
  const html = renderMarkdownToHtml(value || "");
  if (!html) {
    return null;
  }

  return (
    <Typography
      variant="small"
      className={mergeClassNames("prose prose-sm max-w-none dark:prose-invert", className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
