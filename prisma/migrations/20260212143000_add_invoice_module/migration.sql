-- CreateTable
CREATE TABLE "InvoiceSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "triggerTopic" TEXT NOT NULL DEFAULT 'orders/paid',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "defaultLocale" TEXT NOT NULL DEFAULT 'en',
    "fromName" TEXT,
    "fromEmail" TEXT,
    "replyToEmail" TEXT,
    "emailSubjectEn" TEXT,
    "emailSubjectEt" TEXT,
    "emailBodyEn" TEXT,
    "emailBodyEt" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "activeVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceTemplateVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "html" TEXT NOT NULL,
    "css" TEXT,
    "tokensJson" TEXT,
    "createdBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceLocaleMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "storefrontLang" TEXT NOT NULL,
    "invoiceLocale" TEXT NOT NULL,
    "templateId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "orderEmail" TEXT,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generated',
    "pdfStorageType" TEXT,
    "pdfStorageKey" TEXT,
    "pdfUrl" TEXT,
    "checksum" TEXT,
    "sentAt" DATETIME,
    "sentToEmail" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "InvoiceJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "triggerTopic" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT,
    "orderEmail" TEXT,
    "orderLocale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastError" TEXT,
    "payloadJson" TEXT,
    "lockedAt" DATETIME,
    "lockOwner" TEXT,
    "runAfter" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSettings_shop_key" ON "InvoiceSettings"("shop");

-- CreateIndex
CREATE INDEX "InvoiceTemplate_shop_locale_idx" ON "InvoiceTemplate"("shop", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplate_shop_locale_name_key" ON "InvoiceTemplate"("shop", "locale", "name");

-- CreateIndex
CREATE INDEX "InvoiceTemplateVersion_templateId_isPublished_idx" ON "InvoiceTemplateVersion"("templateId", "isPublished");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceTemplateVersion_templateId_version_key" ON "InvoiceTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceLocaleMapping_shop_storefrontLang_key" ON "InvoiceLocaleMapping"("shop", "storefrontLang");

-- CreateIndex
CREATE INDEX "InvoiceLocaleMapping_shop_invoiceLocale_idx" ON "InvoiceLocaleMapping"("shop", "invoiceLocale");

-- CreateIndex
CREATE INDEX "InvoiceDocument_shop_createdAt_idx" ON "InvoiceDocument"("shop", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceDocument_shop_orderId_locale_key" ON "InvoiceDocument"("shop", "orderId", "locale");

-- CreateIndex
CREATE INDEX "InvoiceJob_shop_status_runAfter_idx" ON "InvoiceJob"("shop", "status", "runAfter");

-- CreateIndex
CREATE INDEX "InvoiceJob_status_createdAt_idx" ON "InvoiceJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceJob_shop_triggerTopic_orderId_key" ON "InvoiceJob"("shop", "triggerTopic", "orderId");
