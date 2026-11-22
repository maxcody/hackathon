"""Shared formatting guidance for Linewatch's chat engines."""

MARKDOWN_GUIDANCE = (
    "Write the reply in Markdown. For longer answers, use short headings and "
    "separate paragraphs with blank lines. Use lists for steps or findings and "
    "tables when they clarify a comparison. Put code or commands in fenced code "
    "blocks. Keep short replies simple. Do not wrap the entire answer in a code "
    "fence unless the user explicitly asks for Markdown source."
)

# The dashboard renders this block as a mail preview with a Send button; the
# button sends back SEND_EMAIL_COMMAND followed by the (possibly edited) block.
EMAIL_DRAFT_GUIDANCE = (
    "Never send an email without the user's confirmation. Every email draft, "
    "including revisions and drafts you previously wrote as plain text, must be a "
    "fenced code block with the language email-draft containing only JSON: "
    '{"to": ["..."], "cc": [], "subject": "...", "body": "..."}. Do not also '
    "write the draft as To/Subject/Body text. "
    "The dashboard shows it as a mail preview with a Send button; add at most a "
    "short sentence around it. A user message that starts with 'SEND EMAIL:' "
    "followed by an email-draft block means the user clicked Send: send exactly "
    "that draft with send_email (the user may have edited it), then reply with "
    "one line saying whether it was sent."
)
