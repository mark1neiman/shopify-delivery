type InvoicePdfItem = {
  index: number;
  description: string;
  sku: string;
  quantity: number;
  unitPrice: string;
  discount: string;
  subtotal: string;
};

type InvoicePdfSummaryRow = {
  label: string;
  value: string;
  strong?: boolean;
};

type InvoicePdfInfoBlock = {
  title: string;
  lines: string[];
};

export type GenerateInvoicePdfInput = {
  topDate: string;
  topCaption: string;
  printLabel: string;
  sellerName: string;
  brandContactLine: string;
  orderMetaLeft: string;
  orderMetaRight: string;
  shipping: InvoicePdfInfoBlock;
  billing: InvoicePdfInfoBlock;
  totalsTitle: string;
  totalsRows: InvoicePdfSummaryRow[];
  paymentTitle: string;
  paymentMethod: string;
  trackingLabel: string;
  shippingMethod: string;
  vatRegistrationLine: string;
  tableCaption: string;
  tableHeaders: {
    index: string;
    item: string;
    sku: string;
    qty: string;
    unitPrice: string;
    discount: string;
    subtotal: string;
  };
  items: InvoicePdfItem[];
  extraDiscountLabel: string;
  extraDiscountNote: string;
  extraDiscountValue: string;
  legalLines: string[];
};

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

const WIN_ANSI_MAP: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  "ƒ": 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  "ˆ": 0x88,
  "‰": 0x89,
  "Š": 0x8a,
  "‹": 0x8b,
  "Œ": 0x8c,
  "Ž": 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  "š": 0x9a,
  "›": 0x9b,
  "œ": 0x9c,
  "ž": 0x9e,
  "Ÿ": 0x9f,
};

function toWinAnsiBytes(input: string): number[] {
  const normalized = input.replace(/\r?\n/g, " ");
  const bytes: number[] = [];

  for (const char of normalized) {
    const mapped = WIN_ANSI_MAP[char];
    if (mapped != null) {
      bytes.push(mapped);
      continue;
    }

    const code = char.charCodeAt(0);
    if (code <= 0xff) {
      bytes.push(code);
      continue;
    }

    const fallback = char
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\x20-\x7E]/g, "?");
    if (!fallback) {
      bytes.push(0x3f);
      continue;
    }

    for (const fallbackChar of fallback) {
      const fallbackCode = fallbackChar.charCodeAt(0);
      bytes.push(fallbackCode <= 0xff ? fallbackCode : 0x3f);
    }
  }

  return bytes;
}

function escapePdfText(value: string): string {
  const bytes = toWinAnsiBytes(value);
  let encoded = "";
  for (const byte of bytes) {
    if (byte === 0x5c) {
      encoded += "\\\\";
      continue;
    }
    if (byte === 0x28) {
      encoded += "\\(";
      continue;
    }
    if (byte === 0x29) {
      encoded += "\\)";
      continue;
    }
    if (byte < 32 || byte > 126) {
      encoded += `\\${byte.toString(8).padStart(3, "0")}`;
      continue;
    }
    encoded += String.fromCharCode(byte);
  }
  return encoded;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 3)}...`;
}

function drawText(commands: string[], x: number, y: number, text: string, fontSize = 10, bold = false) {
  const font = bold ? "F2" : "F1";
  commands.push(`BT /${font} ${fontSize} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapePdfText(text)}) Tj ET`);
}

function drawTextRight(commands: string[], rightX: number, y: number, text: string, fontSize = 10, bold = false) {
  const safeText = asString(text);
  const approxWidth = safeText.length * fontSize * 0.5;
  const x = Math.max(0, rightX - approxWidth);
  drawText(commands, x, y, safeText, fontSize, bold);
}

function drawLine(commands: string[], x1: number, y1: number, x2: number, y2: number) {
  commands.push(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
}

function drawRect(commands: string[], x: number, yTop: number, width: number, height: number) {
  const yBottom = yTop - height;
  commands.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function drawFilledRect(commands: string[], x: number, yTop: number, width: number, height: number, gray = 0.95) {
  const yBottom = yTop - height;
  commands.push(`${gray.toFixed(3)} g`);
  commands.push(`${x.toFixed(2)} ${yBottom.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  commands.push("0 g");
}

function drawInfoBlock(commands: string[], x: number, yTop: number, block: InvoicePdfInfoBlock): number {
  const lines = block.lines.map(asString).filter(Boolean);
  drawText(commands, x, yTop, block.title, 11, true);
  let rowY = yTop - 14;
  for (const line of lines.slice(0, 6)) {
    drawText(commands, x, rowY, truncate(line, 56), 9, false);
    rowY -= 11;
  }
  return 14 + Math.max(1, Math.min(6, lines.length)) * 11;
}

function wrapText(value: string, maxCharsPerLine: number, maxLines: number): string[] {
  const text = asString(value);
  if (!text) return [""];
  if (maxCharsPerLine <= 0 || maxLines <= 0) return [text];

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    const next = `${current} ${word}`;
    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;
    if (lines.length >= maxLines) break;
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    lines.length = maxLines;
  }

  const consumedWords = lines.join(" ").split(/\s+/).filter(Boolean).length;
  for (let index = 0; index < lines.length; index += 1) {
    lines[index] = truncate(lines[index], maxCharsPerLine);
  }

  if (consumedWords < words.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = truncate(last, Math.max(3, maxCharsPerLine));
  }

  return lines;
}

function buildPdfDocument(pageContentStreams: string[]): Buffer {
  const objects: Array<string | null> = [null];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";

  const pageIds: number[] = [];
  let nextObjectId = 5;

  for (const stream of pageContentStreams) {
    const contentId = nextObjectId++;
    const pageId = nextObjectId++;
    pageIds.push(pageId);
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  }

  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const parts: Buffer[] = [header];
  const offsets: number[] = [0];
  let totalLength = header.length;

  for (let objectId = 1; objectId < objects.length; objectId += 1) {
    const payload = objects[objectId] || "";
    offsets[objectId] = totalLength;
    const chunk = Buffer.from(`${objectId} 0 obj\n${payload}\nendobj\n`, "utf8");
    parts.push(chunk);
    totalLength += chunk.length;
  }

  const xrefOffset = totalLength;
  const size = objects.length;
  const xrefRows: string[] = [`xref\n0 ${size}\n`, "0000000000 65535 f \n"];
  for (let objectId = 1; objectId < size; objectId += 1) {
    const offset = String(offsets[objectId] || 0).padStart(10, "0");
    xrefRows.push(`${offset} 00000 n \n`);
  }

  const trailer = `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  parts.push(Buffer.from(xrefRows.join("") + trailer, "utf8"));
  return Buffer.concat(parts);
}

export function generateInvoicePdf(input: GenerateInvoicePdfInput): Buffer {
  const commands: string[] = ["0 g", "0.7 w"];
  const left = 36;
  const right = 559;
  const pageWidth = right - left;
  let y = 812;

  drawText(commands, left, y, asString(input.topDate), 9, false);
  drawText(commands, 360, y, truncate(asString(input.topCaption), 44), 9, false);
  y -= 36;

  commands.push("0.184 0.561 0.184 rg");
  drawText(commands, left, y, truncate(asString(input.sellerName), 26), 42, true);
  commands.push("0 0 0 rg");
  y -= 26;

  drawText(commands, left, y, truncate(asString(input.brandContactLine), 95), 14, false);
  y -= 18;

  drawLine(commands, left, y, right, y);
  y -= 16;
  drawText(commands, left, y, truncate(asString(input.orderMetaLeft), 56), 11, true);
  drawText(commands, 305, y, truncate(asString(input.orderMetaRight), 56), 11, true);
  y -= 8;
  drawLine(commands, left, y, right, y);
  y -= 16;

  const blockGap = 20;
  const blockWidth = (pageWidth - blockGap) / 2;
  const leftBlockHeight = drawInfoBlock(commands, left, y, input.shipping);
  const rightBlockHeight = drawInfoBlock(commands, left + blockWidth + blockGap, y, input.billing);
  y -= Math.max(leftBlockHeight, rightBlockHeight) + 10;

  const totalsRows = input.totalsRows.slice(0, 6);
  drawText(commands, left, y, asString(input.totalsTitle), 11, true);
  let totalsY = y - 14;
  for (const row of totalsRows) {
    drawText(commands, left, totalsY, truncate(asString(row.label), 30), 10, Boolean(row.strong));
    drawText(commands, 192, totalsY, truncate(asString(row.value), 16), 10, Boolean(row.strong));
    totalsY -= 11;
  }

  const paymentX = left + blockWidth + blockGap;
  drawText(commands, paymentX, y, asString(input.paymentTitle), 11, true);
  let paymentY = y - 14;
  drawText(commands, paymentX, paymentY, truncate(asString(input.paymentMethod), 50), 9, false);
  paymentY -= 12;
  drawText(commands, paymentX, paymentY, truncate(asString(input.trackingLabel), 50), 9, true);
  paymentY -= 12;
  drawText(commands, paymentX, paymentY, truncate(asString(input.shippingMethod), 50), 9, false);
  paymentY -= 12;
  drawText(commands, paymentX, paymentY, truncate(asString(input.vatRegistrationLine), 50), 9, false);

  y = Math.min(totalsY, paymentY) - 8;

  const captionHeight = 18;
  drawFilledRect(commands, left, y, pageWidth, captionHeight);
  drawRect(commands, left, y, pageWidth, captionHeight);
  drawText(commands, left + 8, y - 12, truncate(asString(input.tableCaption), 80), 10, true);
  y -= captionHeight;

  const headerHeight = 18;
  const rowHeightMin = 15;
  const maxRows = 12;
  const itemRows = input.items.slice(0, maxRows);
  const hiddenRowsCount = Math.max(0, input.items.length - itemRows.length);
  const preparedRows = itemRows.map((item) => {
    const descriptionLines = wrapText(item.description, 38, 3);
    const rowHeight = Math.max(rowHeightMin, descriptionLines.length * 9 + 6);
    return { item, descriptionLines, rowHeight };
  });

  const hiddenRowHeight = hiddenRowsCount > 0 ? rowHeightMin : 0;
  const rowsHeight = preparedRows.reduce((sum, row) => sum + row.rowHeight, 0) + hiddenRowHeight;
  const tableHeight = headerHeight + Math.max(rowHeightMin, rowsHeight);

  drawRect(commands, left, y, pageWidth, tableHeight);
  drawFilledRect(commands, left, y, pageWidth, headerHeight);

  const col = [left, left + 24, left + 204, left + 284, left + 354, left + 399, left + 459, right];
  for (const x of col) {
    drawLine(commands, x, y, x, y - tableHeight);
  }
  drawLine(commands, left, y - headerHeight, right, y - headerHeight);
  let rowDividerY = y - headerHeight;
  for (const row of preparedRows) {
    rowDividerY -= row.rowHeight;
    drawLine(commands, left, rowDividerY, right, rowDividerY);
  }
  if (hiddenRowsCount > 0) {
    rowDividerY -= hiddenRowHeight;
    drawLine(commands, left, rowDividerY, right, rowDividerY);
  }

  drawText(commands, left + 4, y - 12, input.tableHeaders.index, 8, true);
  drawText(commands, col[1] + 4, y - 12, input.tableHeaders.item, 8, true);
  drawText(commands, col[2] + 4, y - 12, input.tableHeaders.sku, 8, true);
  drawTextRight(commands, col[4] - 4, y - 12, input.tableHeaders.unitPrice, 8, true);
  drawTextRight(commands, col[5] - 4, y - 12, input.tableHeaders.qty, 8, true);
  drawTextRight(commands, col[6] - 4, y - 12, input.tableHeaders.discount, 8, true);
  drawTextRight(commands, right - 4, y - 12, input.tableHeaders.subtotal, 8, true);

  let rowTopY = y - headerHeight;
  for (const row of preparedRows) {
    const rowTextY = rowTopY - 10;
    const centeredY = rowTopY - row.rowHeight / 2 - 3;

    drawTextRight(commands, col[1] - 4, centeredY, String(row.item.index), 8, false);
    for (let lineIndex = 0; lineIndex < row.descriptionLines.length; lineIndex += 1) {
      drawText(commands, col[1] + 4, rowTextY - lineIndex * 9, row.descriptionLines[lineIndex], 8, false);
    }
    drawText(commands, col[2] + 4, centeredY, truncate(row.item.sku || "-", 20), 8, false);
    drawTextRight(commands, col[4] - 4, centeredY, truncate(row.item.unitPrice, 16), 8, false);
    drawTextRight(commands, col[5] - 4, centeredY, String(row.item.quantity), 8, false);
    drawTextRight(commands, col[6] - 4, centeredY, truncate(row.item.discount, 16), 8, false);
    drawTextRight(commands, right - 4, centeredY, truncate(row.item.subtotal, 16), 8, false);
    rowTopY -= row.rowHeight;
  }

  if (hiddenRowsCount > 0) {
    drawText(commands, col[1] + 4, rowTopY - 10, `+ ${hiddenRowsCount} more item(s)`, 8, false);
  }

  y -= tableHeight + 10;

  const extraHeight = 18;
  drawRect(commands, left, y, pageWidth, extraHeight);
  const extraText = `${asString(input.extraDiscountLabel)}: ${asString(input.extraDiscountNote)}`;
  drawText(commands, left + 8, y - 12, truncate(extraText, 80), 9, true);
  drawTextRight(commands, right - 8, y - 12, truncate(asString(input.extraDiscountValue), 16), 9, true);
  y -= extraHeight + 12;

  for (const line of input.legalLines.slice(0, 4)) {
    drawText(commands, left, y, truncate(asString(line), 118), 9, false);
    y -= 12;
  }

  const stream = commands.join("\n");
  return buildPdfDocument([stream]);
}
