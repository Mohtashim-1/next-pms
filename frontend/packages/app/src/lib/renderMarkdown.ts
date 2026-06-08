const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const renderInlineMarkdown = (value: string) =>
  escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code class='rounded bg-muted px-1 py-0.5 text-[0.85em]'>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<a href='$2' class='text-primary underline' target='_blank' rel='noreferrer'>$1</a>");

const isHtmlContent = (value: string) => /<\/?[a-z][\s\S]*>/i.test(value);

export const renderMarkdownToHtml = (value: string) => {
  if (!value?.trim()) {
    return "";
  }

  if (isHtmlContent(value)) {
    return value;
  }

  const lines = value.split(/\r?\n/);
  const html = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return "<br />";
      }
      if (trimmed.startsWith("- ")) {
        return `<li>${renderInlineMarkdown(trimmed.slice(2))}</li>`;
      }
      if (trimmed.startsWith("### ")) {
        return `<h4 class='font-semibold mt-2 mb-1'>${renderInlineMarkdown(trimmed.slice(4))}</h4>`;
      }
      if (trimmed.startsWith("## ")) {
        return `<h3 class='font-semibold mt-2 mb-1'>${renderInlineMarkdown(trimmed.slice(3))}</h3>`;
      }
      if (trimmed.startsWith("# ")) {
        return `<h2 class='font-semibold mt-2 mb-1'>${renderInlineMarkdown(trimmed.slice(2))}</h2>`;
      }
      return `<p class='mb-1'>${renderInlineMarkdown(trimmed)}</p>`;
    })
    .join("");

  return html.replace(/(<li>.*?<\/li>)+/g, (match) => `<ul class='list-disc pl-5 mb-1'>${match}</ul>`);
};
