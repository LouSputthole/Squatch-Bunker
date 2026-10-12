"use strict";

const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_SCHEMA_VERSION = 7;

const TABLES = [
  [
    'CREATE TABLE IF NOT EXISTS "WebhookEvent" (',
    '  "id" TEXT NOT NULL PRIMARY KEY,',
    '  "status" TEXT NOT NULL DEFAULT \'processing\',',
    '  "updatedAt" DATETIME NOT NULL',
    ')',
  ].join("\n"),
  [
    'CREATE TABLE IF NOT EXISTS "Report" (',
    '  "id" TEXT NOT NULL PRIMARY KEY,',
    '  "reporterId" TEXT NOT NULL,',
    '  "targetUserId" TEXT NOT NULL,',
    '  "messageId" TEXT,',
    '  "reason" TEXT NOT NULL,',
    '  "status" TEXT NOT NULL DEFAULT \'open\',',
    '  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    '  CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,',
    '  CONSTRAINT "Report_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE',
    ')',
  ].join("\n"),
  `CREATE TABLE IF NOT EXISTS "PrivateUpload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "claimKind" TEXT,
    "claimId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" DATETIME,
    CONSTRAINT "PrivateUpload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "UserBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "content" TEXT NOT NULL,
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "privateUploadId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_privateUploadId_fkey" FOREIGN KEY ("privateUploadId") REFERENCES "PrivateUpload" ("id") ON DELETE SET NULL ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Poll" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "closesAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Poll_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Poll_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Poll_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Poll_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PollOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "PollVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pollId" TEXT NOT NULL,
    "optionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PollVote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "Gathering" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serverId" TEXT NOT NULL,
    "channelId" TEXT,
    "creatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Gathering_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "Server" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Gathering_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Gathering_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "GatheringRsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gatheringId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'going',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GatheringRsvp_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GatheringRsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  // Ember Inbox (schema v7): the upgrader had skipped this wave, so a 0.0.3
  // install upgraded in place lacked the table the inbox reads.
  `CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "serverId" TEXT,
    "channelId" TEXT,
    "conversationId" TEXT,
    "messageId" TEXT,
    "actorId" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ReportEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReportEvent_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "ReportAppeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "appellantId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" DATETIME,
    CONSTRAINT "ReportAppeal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReportAppeal_appellantId_fkey" FOREIGN KEY ("appellantId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
];

// Ranger Desk (schema v6): message reports filed before the desk learn their
// community and evidence from the message where it still exists, and every
// report gets its "filed" case event. Same statements as the PostgreSQL
// migration 20261012000000_ranger_desk.
const REPORT_BACKFILL = [
  `UPDATE "Report" SET
    "serverId" = (SELECT "Channel"."serverId" FROM "Message" JOIN "Channel" ON "Channel"."id" = "Message"."channelId" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceContent" = (SELECT "Message"."content" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceAttachmentName" = (SELECT "Message"."attachmentName" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceAttachmentUrl" = (SELECT "Message"."attachmentUrl" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceChannelId" = (SELECT "Message"."channelId" FROM "Message" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceChannelName" = (SELECT "Channel"."name" FROM "Message" JOIN "Channel" ON "Channel"."id" = "Message"."channelId" WHERE "Message"."id" = "Report"."messageId"),
    "evidenceMessageAt" = (SELECT "Message"."createdAt" FROM "Message" WHERE "Message"."id" = "Report"."messageId")
  WHERE "serverId" IS NULL
    AND "messageId" IS NOT NULL
    AND EXISTS (SELECT 1 FROM "Message" WHERE "Message"."id" = "Report"."messageId")`,
  `INSERT INTO "ReportEvent" ("id", "reportId", "actorId", "type", "createdAt")
  SELECT 'legacy-filed-' || "Report"."id", "Report"."id", "Report"."reporterId", 'filed', "Report"."createdAt"
  FROM "Report"
  WHERE NOT EXISTS (SELECT 1 FROM "ReportEvent" WHERE "ReportEvent"."reportId" = "Report"."id")`,
];

const REPORT_CASE_COLUMNS = [
  ["serverId", 'TEXT REFERENCES "Server" ("id") ON DELETE SET NULL ON UPDATE CASCADE'],
  ["assigneeId", 'TEXT REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE'],
  ["assignedAt", "DATETIME"],
  ["escalatedById", "TEXT"],
  ["escalatedAt", "DATETIME"],
  ["escalationNote", "TEXT"],
  ["resolvedById", "TEXT"],
  ["resolvedAt", "DATETIME"],
  ["resolution", "TEXT"],
  ["resolutionNote", "TEXT"],
  ["evidenceContent", "TEXT"],
  ["evidenceAttachmentName", "TEXT"],
  ["evidenceAttachmentUrl", "TEXT"],
  ["evidenceChannelId", "TEXT"],
  ["evidenceChannelName", "TEXT"],
  ["evidenceMessageAt", "DATETIME"],
];

const INDEXES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS "PrivateUpload_storageKey_key" ON "PrivateUpload"("storageKey")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "PrivateUpload_claimKind_claimId_key" ON "PrivateUpload"("claimKind", "claimId")',
  'CREATE INDEX IF NOT EXISTS "PrivateUpload_ownerId_state_createdAt_idx" ON "PrivateUpload"("ownerId", "state", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Message_privateUploadId_key" ON "Message"("privateUploadId")',
  'CREATE INDEX IF NOT EXISTS "Report_targetUserId_status_idx" ON "Report"("targetUserId", "status")',
  'CREATE INDEX IF NOT EXISTS "Report_reporterId_idx" ON "Report"("reporterId")',
  'CREATE INDEX IF NOT EXISTS "Report_serverId_status_createdAt_idx" ON "Report"("serverId", "status", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "Report_assigneeId_idx" ON "Report"("assigneeId")',
  'CREATE INDEX IF NOT EXISTS "ReportEvent_reportId_createdAt_idx" ON "ReportEvent"("reportId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "ReportAppeal_reportId_key" ON "ReportAppeal"("reportId")',
  'CREATE INDEX IF NOT EXISTS "ReportAppeal_appellantId_status_idx" ON "ReportAppeal"("appellantId", "status")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "DirectMessage_privateUploadId_key" ON "DirectMessage"("privateUploadId")',
  'CREATE INDEX IF NOT EXISTS "JournalEntry_privateUploadId_idx" ON "JournalEntry"("privateUploadId")',
  'CREATE INDEX IF NOT EXISTS "UserBlock_blockedId_idx" ON "UserBlock"("blockedId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId")',
  'CREATE INDEX IF NOT EXISTS "JournalEntry_serverId_createdAt_idx" ON "JournalEntry"("serverId", "createdAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "Poll_messageId_key" ON "Poll"("messageId")',
  'CREATE INDEX IF NOT EXISTS "Poll_channelId_createdAt_idx" ON "Poll"("channelId", "createdAt")',
  'CREATE INDEX IF NOT EXISTS "PollOption_pollId_position_idx" ON "PollOption"("pollId", "position")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "PollVote_optionId_userId_key" ON "PollVote"("optionId", "userId")',
  'CREATE INDEX IF NOT EXISTS "PollVote_pollId_userId_idx" ON "PollVote"("pollId", "userId")',
  'CREATE INDEX IF NOT EXISTS "Gathering_serverId_startsAt_idx" ON "Gathering"("serverId", "startsAt")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "GatheringRsvp_gatheringId_userId_key" ON "GatheringRsvp"("gatheringId", "userId")',
  'CREATE INDEX IF NOT EXISTS "GatheringRsvp_userId_status_idx" ON "GatheringRsvp"("userId", "status")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeCustomerId_key" ON "User"("stripeCustomerId")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId")',
  'CREATE INDEX IF NOT EXISTS "User_billingCheckoutPendingAt_idx" ON "User"("billingCheckoutPendingAt")',
  'CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt")',
  'CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt")',
];

function quoteIdentifier(identifier) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe desktop migration identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function tableExists(database, table) {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function tableColumns(database, table) {
  if (!tableExists(database, table)) return new Set();
  return new Set(
    database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((column) => column.name),
  );
}

function assertForeignKey(database, table, column, referencedTable, onDelete) {
  requireTable(database, table);
  const foreignKey = database
    .prepare(`PRAGMA foreign_key_list(` + quoteIdentifier(table) + ")")
    .all()
    .find(
      (entry) =>
        entry.from === column &&
        entry.table === referencedTable &&
        entry.to === "id" &&
        entry.on_delete === onDelete,
    );
  if (!foreignKey) {
    throw new Error(
      `Desktop database is missing ${table}.${column} foreign key to ${referencedTable}`,
    );
  }
}

function requireTable(database, table) {
  if (!tableExists(database, table)) {
    throw new Error(`Desktop database is missing required table ${table}`);
  }
}

function addColumn(database, table, column, definition) {
  requireTable(database, table);
  if (tableColumns(database, table).has(column)) return;
  database.exec(
    `ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN ${quoteIdentifier(column)} ${definition}`,
  );
}

// The backfill reads the message columns Campfire has always had; a database
// too old to have them (none shipped) just keeps its reports unscoped.
function canBackfillReports(database) {
  const message = tableColumns(database, "Message");
  const channel = tableColumns(database, "Channel");
  return (
    ["content", "attachmentName", "attachmentUrl", "channelId", "createdAt"].every((c) => message.has(c)) &&
    ["serverId", "name"].every((c) => channel.has(c))
  );
}

function assertNoDuplicates(database, table, column) {
  if (!tableColumns(database, table).has(column)) {
    throw new Error(`Desktop database is missing ${table}.${column}`);
  }
  const quotedTable = quoteIdentifier(table);
  const quotedColumn = quoteIdentifier(column);
  const duplicate = database
    .prepare(
      `SELECT 1 FROM ${quotedTable} WHERE ${quotedColumn} IS NOT NULL GROUP BY ${quotedColumn} HAVING COUNT(*) > 1 LIMIT 1`,
    )
    .get();
  if (duplicate) {
    throw new Error(
      `Desktop upgrade cannot add a unique index while ${table}.${column} has duplicates`,
    );
  }
}

function assertIntegrity(database) {
  const integrity = database.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") {
    throw new Error(`Desktop SQLite integrity_check failed: ${integrity}`);
  }
  const foreignKeys = database.pragma("foreign_key_check");
  if (foreignKeys.length > 0) {
    throw new Error(
      `Desktop SQLite foreign_key_check found ${foreignKeys.length} violation(s)`,
    );
  }
}

function assertCurrentSchema(database) {
  const requiredColumns = {
    User: ["billingCheckoutPendingAt", "billingEventAt", "quietHoursStart", "quietHoursEnd"],
    Server: [
      "inviteExpiresAt",
      "inviteMaxUses",
      "inviteUseCount",
      "inviteRevokedAt",
    ],
    WebhookEvent: ["id", "status", "updatedAt"],
    Report: [
      "id",
      "reporterId",
      "targetUserId",
      "reason",
      "status",
      ...REPORT_CASE_COLUMNS.map(([column]) => column),
    ],
    Notification: ["id", "userId", "type", "title", "body", "serverId", "channelId", "conversationId", "messageId", "actorId", "readAt", "createdAt"],
    ReportEvent: ["id", "reportId", "actorId", "type", "detail", "createdAt"],
    ReportAppeal: ["id", "reportId", "appellantId", "reason", "status", "decidedById", "decisionNote", "createdAt", "decidedAt"],
    Channel: ["roomMode", "roomScene", "retentionDays"],
    Message: ["privateUploadId"],
    DirectMessage: ["privateUploadId"],
    PrivateUpload: [
      "id",
      "ownerId",
      "storageKey",
      "originalName",
      "contentType",
      "byteSize",
      "state",
      "claimKind",
      "claimId",
      "createdAt",
      "claimedAt",
    ],
    UserBlock: ["id", "blockerId", "blockedId", "createdAt"],
    JournalEntry: ["id", "serverId", "authorId", "content"],
    Poll: ["id", "serverId", "channelId", "messageId", "creatorId"],
    PollOption: ["id", "pollId", "text", "position"],
    PollVote: ["id", "pollId", "optionId", "userId"],
    Gathering: ["id", "serverId", "creatorId", "startsAt"],
    GatheringRsvp: ["id", "gatheringId", "userId", "status"],
  };
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const present = tableColumns(database, table);
    for (const column of columns) {
      if (!present.has(column)) {
        throw new Error(`Desktop database is missing ${table}.${column}`);
      }
    }
  }
  assertForeignKey(database, "PrivateUpload", "ownerId", "User", "RESTRICT");
  assertForeignKey(database, "Report", "reporterId", "User", "CASCADE");
  assertForeignKey(database, "Report", "targetUserId", "User", "CASCADE");
  assertForeignKey(database, "Report", "serverId", "Server", "SET NULL");
  assertForeignKey(database, "Report", "assigneeId", "User", "SET NULL");
  assertForeignKey(database, "Notification", "userId", "User", "CASCADE");
  assertForeignKey(database, "ReportEvent", "reportId", "Report", "CASCADE");
  assertForeignKey(database, "ReportAppeal", "reportId", "Report", "CASCADE");
  assertForeignKey(database, "ReportAppeal", "appellantId", "User", "CASCADE");
  assertForeignKey(database, "Message", "privateUploadId", "PrivateUpload", "SET NULL");
  assertForeignKey(database, "DirectMessage", "privateUploadId", "PrivateUpload", "SET NULL");
  assertForeignKey(database, "JournalEntry", "privateUploadId", "PrivateUpload", "SET NULL");

  for (const sql of INDEXES) {
    const name = sql.match(/INDEX IF NOT EXISTS "([^"]+)"/)?.[1];
    if (
      !name ||
      !database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
        .get(name)
    ) {
      throw new Error(`Desktop database is missing required index ${name || "unknown"}`);
    }
  }
}

function backupDatabase(databasePath) {
  const backupDirectory = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(
    backupDirectory,
    `${path.basename(databasePath)}.pre-v${DESKTOP_SCHEMA_VERSION}.${timestamp}.bak`,
  );
  fs.copyFileSync(databasePath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function defaultDatabaseConstructor(serverRoot) {
  if (!serverRoot) throw new Error("Desktop server root is required");
  return require(path.join(serverRoot, "node_modules", "better-sqlite3"));
}

function upgradeDesktopDatabase({
  databasePath,
  serverRoot = null,
  Database: InjectedDatabase,
  log = console.log,
}) {
  const Database = InjectedDatabase || defaultDatabaseConstructor(serverRoot);
  const database = new Database(databasePath);
  try {
    database.pragma("foreign_keys = ON");
    assertIntegrity(database);
    database.pragma("wal_checkpoint(TRUNCATE)");

    const currentVersion = database.pragma("user_version", { simple: true });
    if (currentVersion > DESKTOP_SCHEMA_VERSION) {
      throw new Error(
        `Desktop database schema ${currentVersion} is newer than this app supports (${DESKTOP_SCHEMA_VERSION})`,
      );
    }
    if (currentVersion === DESKTOP_SCHEMA_VERSION) {
      assertCurrentSchema(database);
      return { upgraded: false, backupPath: null };
    }

    for (const table of ["User", "Server", "Channel", "Message", "Friendship"]) {
      requireTable(database, table);
    }
    requireTable(database, "DirectMessage");
    assertNoDuplicates(database, "User", "stripeCustomerId");
    assertNoDuplicates(database, "User", "stripeSubscriptionId");

    const backupPath = backupDatabase(databasePath);
    log(`[Campfire] Backed up desktop database to ${backupPath}`);

    const migrate = database.transaction(() => {
      addColumn(database, "Server", "inviteExpiresAt", "DATETIME");
      addColumn(database, "Server", "inviteMaxUses", "INTEGER");
      addColumn(database, "Server", "inviteUseCount", "INTEGER NOT NULL DEFAULT 0");
      addColumn(database, "Server", "inviteRevokedAt", "DATETIME");
      addColumn(database, "Channel", "roomMode", "TEXT NOT NULL DEFAULT 'hangout'");
      addColumn(database, "Channel", "roomScene", "TEXT NOT NULL DEFAULT 'campfire'");
      addColumn(database, "Channel", "retentionDays", "INTEGER");
      addColumn(database, "User", "billingCheckoutPendingAt", "DATETIME");
      addColumn(database, "User", "billingEventAt", "DATETIME");
      addColumn(database, "User", "quietHoursStart", "INTEGER");
      addColumn(database, "User", "quietHoursEnd", "INTEGER");

      for (const sql of TABLES) database.exec(sql);
      addColumn(
        database,
        "Message",
        "privateUploadId",
        'TEXT REFERENCES "PrivateUpload" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
      );
      addColumn(
        database,
        "DirectMessage",
        "privateUploadId",
        'TEXT REFERENCES "PrivateUpload" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
      );
      addColumn(
        database,
        "JournalEntry",
        "privateUploadId",
        'TEXT REFERENCES "PrivateUpload" ("id") ON DELETE SET NULL ON UPDATE CASCADE',
      );

      const friendshipColumns = tableColumns(database, "Friendship");
      const timestampColumn = friendshipColumns.has("updatedAt")
        ? '"updatedAt"'
        : "CURRENT_TIMESTAMP";
      if (
        friendshipColumns.has("status") &&
        friendshipColumns.has("requesterId") &&
        friendshipColumns.has("addresseeId")
      ) {
        database.exec(
          `INSERT OR IGNORE INTO "UserBlock" ("id", "blockerId", "blockedId", "createdAt")
           SELECT 'legacy-block-' || "id", "addresseeId", "requesterId", ${timestampColumn}
           FROM "Friendship"
           WHERE "status" = 'blocked' AND "addresseeId" <> "requesterId"`,
        );
        database.exec(`DELETE FROM "Friendship" WHERE "status" = 'blocked'`);
      }

      for (const [column, definition] of REPORT_CASE_COLUMNS) {
        addColumn(database, "Report", column, definition);
      }
      if (canBackfillReports(database)) {
        for (const sql of REPORT_BACKFILL) database.exec(sql);
      }

      for (const sql of INDEXES) database.exec(sql);

      database.pragma(`user_version = ${DESKTOP_SCHEMA_VERSION}`);
      assertCurrentSchema(database);
      assertIntegrity(database);
    });
    migrate();

    return { upgraded: true, backupPath };
  } finally {
    database.close();
  }
}

module.exports = {
  DESKTOP_SCHEMA_VERSION,
  upgradeDesktopDatabase,
};
