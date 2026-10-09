export function getDomainsExportFilename(entityName: string, date = new Date()): string {
  const safeName = Array.from(entityName.replace(/[<>:"/\\|?*]|\p{Cc}/gu, "_").trim())
    .slice(0, 50)
    .join("")
    .replace(/^\.+|[. ]+$/g, "") || "entity";
  const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
  return `${safeName}-domains-${day}.txt`;
}

export function downloadTextFile(filename: string, lines: readonly string[]): void {
  if (lines.length === 0) return;

  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Let the browser start the download before releasing the object URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
