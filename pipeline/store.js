/*
 * Local persistence (PRD §5.6, §7). SQLite via Node's built-in node:sqlite
 * (no native dependency). Turns the ephemeral pipeline output (attributes +
 * content + range + comps) into a durable per-item record, and doubles as the
 * seed data for a future self-tracked comp source (§9).
 *
 * Schema follows §7:
 *   items(id, status, created_at, attributes_json)
 *   photos(id, item_id, file_path, cluster_confidence)
 *   listings(item_id, title, description, tags, price_range, submitted_at)
 *   comps(item_id, source, sold_price, sold_date, url)
 *   flags(item_id, type, resolved)
 *
 * Nothing here writes to Grailed or the network — pure local storage.
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DEFAULT_DB = path.join(__dirname, '..', 'data', 'resale-studio.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  status        TEXT NOT NULL DEFAULT 'draft',
  created_at    TEXT NOT NULL,
  attributes_json TEXT
);
CREATE TABLE IF NOT EXISTS photos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
  file_path     TEXT NOT NULL,
  cluster_confidence REAL
);
CREATE TABLE IF NOT EXISTS listings (
  item_id       INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
  title         TEXT,
  description   TEXT,
  tags          TEXT,          -- JSON array
  price_range   TEXT,          -- JSON {low,median,high,...}
  content_json  TEXT,          -- full generated content (disclaimers, alternates)
  submitted_at  TEXT           -- set only when the seller manually submits
);
CREATE TABLE IF NOT EXISTS comps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
  source        TEXT,
  sold_price    REAL,
  sold_date     TEXT,
  url           TEXT
);
CREATE TABLE IF NOT EXISTS flags (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER REFERENCES items(id) ON DELETE CASCADE,
  type          TEXT NOT NULL, -- low_confidence_group | multi_item_photo | counterfeit_risk | ...
  detail        TEXT,
  resolved      INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS albums (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL,
  folder        TEXT,
  name          TEXT NOT NULL,
  hidden        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS grouping_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at    TEXT NOT NULL,
  folder        TEXT,
  strategy      TEXT,           -- meta.strategy actually used (after any fallback)
  fallback_from TEXT,           -- set when the primary strategy failed and this run is the fallback
  meta_json     TEXT,           -- full strategy meta (calls, usage, cost, wallMs, notes)
  groups_json   TEXT,           -- per-group summary: photos count, confidence, autoAccept, flags
  event         TEXT NOT NULL DEFAULT 'batch' -- 'batch' now; 'correction' once review split/merge exists (§5.6)
);
`;

function openStore(dbPath = DEFAULT_DB, opts = {}) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  // Migrate DBs created before content_json existed (ignore if already present).
  try { db.exec('ALTER TABLE listings ADD COLUMN content_json TEXT'); } catch {}
  // Migrate DBs created before albums existed: items gain the album they were
  // imported in (NULL for pre-album items → shown as "Earlier items").
  try { db.exec('ALTER TABLE items ADD COLUMN album_id INTEGER REFERENCES albums(id)'); } catch {}
  // Photo order (position 1 = Grailed thumbnail) — editor drags/deletes must
  // reach the DB or autofill uploads the stale set (found in a real run:
  // a deleted duplicate photo was still uploaded). NULL sorts by id (legacy).
  try { db.exec('ALTER TABLE photos ADD COLUMN position INTEGER'); } catch {}
  // Last-autofill snapshot (ui/main.js): the app-level field values sent in the
  // most recent fill + per-field results, so a re-fill can target only what the
  // user changed since. NULL = never filled.
  try { db.exec('ALTER TABLE items ADD COLUMN last_fill_json TEXT'); } catch {}
  // App settings the PIPELINE also reads (description styles must reach
  // generation at import AND on Regenerate, so they can't live in renderer
  // state). Plain key/value; keys: descriptionStyles, defaultTags.
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  const now = () => (opts.now ? new Date(opts.now).toISOString() : new Date().toISOString());

  const api = {
    db,
    close: () => db.close(),

    /** Read one app setting; null when unset. */
    getSetting(key) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    /** Persist one app setting; empty/null value deletes the key. */
    setSetting(key, value) {
      if (value == null || String(value).trim() === '') {
        db.prepare('DELETE FROM settings WHERE key = ?').run(key);
      } else {
        db.prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        ).run(key, String(value));
      }
      return true;
    },

    /**
     * Persist one full pipeline run as an item + its photos, listing, comps, flags.
     * @returns {number} itemId
     */
    saveItemRun({ photos = [], attributes = null, content = null, range = null, comps = [], flags = [], status = 'draft', albumId = null }) {
      const tx = db.exec.bind(db);
      tx('BEGIN');
      try {
        const itemId = db
          .prepare('INSERT INTO items (status, created_at, attributes_json, album_id) VALUES (?, ?, ?, ?)')
          .run(status, now(), attributes ? JSON.stringify(attributes) : null, albumId).lastInsertRowid;

        const insPhoto = db.prepare(
          'INSERT INTO photos (item_id, file_path, cluster_confidence) VALUES (?, ?, ?)'
        );
        for (const p of photos) {
          const fp = typeof p === 'string' ? p : p.file_path;
          const conf = typeof p === 'string' ? null : p.cluster_confidence ?? null;
          insPhoto.run(itemId, fp, conf);
        }

        if (content || range) {
          db.prepare(
            'INSERT INTO listings (item_id, title, description, tags, price_range, content_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
          ).run(
            itemId,
            content?.title ?? null,
            content?.description ?? null,
            content?.tags ? JSON.stringify(content.tags) : null,
            range ? JSON.stringify(range) : null,
            content ? JSON.stringify(content) : null
          );
        }

        const insComp = db.prepare(
          'INSERT INTO comps (item_id, source, sold_price, sold_date, url) VALUES (?, ?, ?, ?, ?)'
        );
        for (const c of comps) {
          insComp.run(itemId, c.source ?? null, c.price ?? c.sold_price ?? null, c.soldDate ?? c.sold_date ?? null, c.url ?? null);
        }

        const insFlag = db.prepare('INSERT INTO flags (item_id, type, detail, resolved) VALUES (?, ?, ?, 0)');
        for (const f of flags) {
          const type = typeof f === 'string' ? f : f.type;
          const detail = typeof f === 'string' ? null : f.detail ?? null;
          insFlag.run(itemId, type, detail);
        }

        tx('COMMIT');
        return Number(itemId);
      } catch (e) {
        tx('ROLLBACK');
        throw e;
      }
    },

    getItem(id) {
      const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
      if (!item) return null;
      return {
        ...item,
        attributes: item.attributes_json ? JSON.parse(item.attributes_json) : null,
        last_fill: item.last_fill_json ? JSON.parse(item.last_fill_json) : null,
        photos: db
          .prepare('SELECT id, file_path, cluster_confidence FROM photos WHERE item_id = ? ORDER BY COALESCE(position, id), id')
          .all(id),
        listing: (() => {
          const l = db.prepare('SELECT * FROM listings WHERE item_id = ?').get(id);
          if (!l) return null;
          return {
            ...l,
            tags: l.tags ? JSON.parse(l.tags) : [],
            price_range: l.price_range ? JSON.parse(l.price_range) : null,
            content: l.content_json ? JSON.parse(l.content_json) : null,
          };
        })(),
        comps: db.prepare('SELECT source, sold_price, sold_date, url FROM comps WHERE item_id = ?').all(id),
        flags: db.prepare('SELECT id, type, detail, resolved FROM flags WHERE item_id = ?').all(id),
      };
    },

    listItems() {
      return db
        .prepare(
          `SELECT i.id, i.status, i.created_at, i.album_id,
                  (SELECT title FROM listings WHERE item_id = i.id) AS title,
                  (SELECT price_range FROM listings WHERE item_id = i.id) AS price_range,
                  (SELECT COUNT(*) FROM photos WHERE item_id = i.id) AS photo_count,
                  (SELECT COUNT(*) FROM flags WHERE item_id = i.id AND resolved = 0) AS open_flags
           FROM items i ORDER BY i.id DESC`
        )
        .all()
        .map((r) => ({ ...r, price_range: r.price_range ? JSON.parse(r.price_range) : null }));
    },

    /**
     * Persist user edits from the review sidebar (Slice 2+). Updates the item's
     * attributes and/or its listing (title/description/tags/price, plus the
     * structured desc_parts and measurements carried inside content_json) in one
     * tx. Any field left undefined/null is left as-is. Upserts the listings row
     * so an item that never had generated content can still be edited + saved.
     */
    saveItemEdits(itemId, { content = null, range = null, attributes = null, descParts = null, measurements = null, photos = null } = {}) {
      const tx = db.exec.bind(db);
      tx('BEGIN');
      try {
        if (attributes != null) {
          db.prepare('UPDATE items SET attributes_json = ? WHERE id = ?').run(JSON.stringify(attributes), itemId);
        }
        if (photos != null) {
          // `photos` = photo ids in display order (position 0 = Grailed
          // thumbnail). Rows of THIS item missing from the list are deleted
          // (the editor's ✗) — DB only, files on disk untouched. Ids that
          // aren't the item's own photos are ignored.
          const existing = db.prepare('SELECT id FROM photos WHERE item_id = ?').all(itemId).map((r) => Number(r.id));
          const keep = photos.map(Number).filter((id) => existing.includes(id));
          const del = db.prepare('DELETE FROM photos WHERE item_id = ? AND id = ?');
          for (const id of existing) if (!keep.includes(id)) del.run(itemId, id);
          const upd = db.prepare('UPDATE photos SET position = ? WHERE item_id = ? AND id = ?');
          keep.forEach((id, i) => upd.run(i, itemId, id));
        }
        if (content != null || range != null || descParts != null || measurements != null) {
          const cur = db.prepare('SELECT * FROM listings WHERE item_id = ?').get(itemId);
          const title = content?.title ?? cur?.title ?? null;
          const description = content?.description ?? cur?.description ?? null;
          const tags = content?.tags ?? (cur?.tags ? JSON.parse(cur.tags) : []);
          const priceRange = range ?? (cur?.price_range ? JSON.parse(cur.price_range) : null);
          // content_json is the source of truth the UI reads back first — keep it
          // in sync with the columns, and fold in the structured desc_parts +
          // measurements (which have no dedicated columns) so they survive reload.
          const curContent = cur?.content_json ? JSON.parse(cur.content_json) : {};
          const contentJson = {
            ...curContent,
            ...(content ?? {}),
            ...(descParts != null ? { desc_parts: descParts } : {}),
            ...(measurements != null ? { measurements } : {}),
          };
          if (cur) {
            db.prepare(
              'UPDATE listings SET title = ?, description = ?, tags = ?, price_range = ?, content_json = ? WHERE item_id = ?'
            ).run(
              title,
              description,
              JSON.stringify(tags),
              priceRange ? JSON.stringify(priceRange) : null,
              contentJson ? JSON.stringify(contentJson) : null,
              itemId
            );
          } else {
            db.prepare(
              'INSERT INTO listings (item_id, title, description, tags, price_range, content_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
            ).run(
              itemId,
              title,
              description,
              JSON.stringify(tags),
              priceRange ? JSON.stringify(priceRange) : null,
              contentJson ? JSON.stringify(contentJson) : null
            );
          }
        }
        tx('COMMIT');
      } catch (e) {
        tx('ROLLBACK');
        throw e;
      }
    },

    /**
     * Review-queue resolution (§5.1 "confirm, merge, split, or reassign" —
     * UX review S1). All additive; nothing here touches Grailed.
     */

    /** Apply a full pipeline run to an EXISTING item (review "confirm as one
     * item"): attributes + listing + comps land on the item, its open flags
     * resolve, and it becomes a draft. Photos stay as they are. */
    updateItemRun(itemId, { attributes = null, content = null, range = null, comps = [], status = 'draft' }) {
      const tx = db.exec.bind(db);
      tx('BEGIN');
      try {
        db.prepare('UPDATE items SET status = ?, attributes_json = ? WHERE id = ?').run(
          status,
          attributes ? JSON.stringify(attributes) : null,
          itemId
        );
        db.prepare('DELETE FROM listings WHERE item_id = ?').run(itemId);
        if (content || range) {
          db.prepare(
            'INSERT INTO listings (item_id, title, description, tags, price_range, content_json, submitted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
          ).run(
            itemId,
            content?.title ?? null,
            content?.description ?? null,
            content?.tags ? JSON.stringify(content.tags) : null,
            range ? JSON.stringify(range) : null,
            content ? JSON.stringify(content) : null
          );
        }
        db.prepare('DELETE FROM comps WHERE item_id = ?').run(itemId);
        const insComp = db.prepare('INSERT INTO comps (item_id, source, sold_price, sold_date, url) VALUES (?, ?, ?, ?, ?)');
        for (const c of comps) {
          insComp.run(itemId, c.source ?? null, c.price ?? c.sold_price ?? null, c.soldDate ?? c.sold_date ?? null, c.url ?? null);
        }
        db.prepare('UPDATE flags SET resolved = 1 WHERE item_id = ? AND resolved = 0').run(itemId);
        tx('COMMIT');
      } catch (e) {
        tx('ROLLBACK');
        throw e;
      }
    },

    /** Append photos (file paths) to an item, after its current last photo —
     * the editor's real "+ add photo" (UX audit #1). Returns the item's fresh
     * photo rows in display order (same shape/order as getItem's photos). */
    addPhotos(itemId, paths) {
      if (!db.prepare('SELECT id FROM items WHERE id = ?').get(itemId)) {
        throw new Error(`Item ${itemId} not found.`);
      }
      const tx = db.exec.bind(db);
      tx('BEGIN');
      try {
        // New rows must sort AFTER every existing photo. Legacy rows have
        // NULL position and sort by id, so the append point is
        // max(COALESCE(position, id)) — a row count would sort before them.
        const m = db.prepare('SELECT MAX(COALESCE(position, id)) AS m FROM photos WHERE item_id = ?').get(itemId).m;
        let pos = m == null ? 0 : Number(m) + 1;
        const ins = db.prepare('INSERT INTO photos (item_id, file_path, cluster_confidence, position) VALUES (?, ?, NULL, ?)');
        for (const p of paths) ins.run(itemId, String(p), pos++);
        tx('COMMIT');
      } catch (e) {
        tx('ROLLBACK');
        throw e;
      }
      return db
        .prepare('SELECT id, file_path, cluster_confidence FROM photos WHERE item_id = ? ORDER BY COALESCE(position, id), id')
        .all(itemId);
    },

    /** Move photos (by photo id) onto another item. */
    movePhotos(photoIds, targetItemId) {
      const upd = db.prepare('UPDATE photos SET item_id = ? WHERE id = ?');
      for (const pid of photoIds) upd.run(targetItemId, pid);
    },

    /** New empty review item (split target); flagged so the queue explains it. */
    createReviewItem(flagDetail = null) {
      const itemId = Number(
        db.prepare("INSERT INTO items (status, created_at, attributes_json) VALUES ('needs_review', ?, NULL)").run(now())
          .lastInsertRowid
      );
      db.prepare('INSERT INTO flags (item_id, type, detail, resolved) VALUES (?, ?, ?, 0)').run(
        itemId,
        'split_review',
        flagDetail
      );
      return itemId;
    },

    /**
     * Albums (Lightroom-style): one album per import batch, so finished
     * batches can be hidden from the Home lists without deleting anything.
     * Hiding is a pure UI concern — nothing else reads `hidden`.
     */
    createAlbum({ folder = null, name }) {
      return Number(
        db.prepare('INSERT INTO albums (created_at, folder, name, hidden) VALUES (?, ?, ?, 0)').run(now(), folder, name)
          .lastInsertRowid
      );
    },
    listAlbums() {
      return db
        .prepare(
          `SELECT a.id, a.created_at, a.folder, a.name, a.hidden,
                  (SELECT COUNT(*) FROM items WHERE album_id = a.id) AS item_count,
                  (SELECT COUNT(*) FROM items WHERE album_id = a.id AND status = 'submitted') AS listed_count,
                  (SELECT COUNT(*) FROM items WHERE album_id = a.id AND status = 'needs_review') AS review_count
           FROM albums a ORDER BY a.id DESC`
        )
        .all();
    },
    setAlbumHidden(albumId, hidden) {
      db.prepare('UPDATE albums SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, albumId);
      return true;
    },

    /** Permanently delete an item and everything attached (photos/listings/
     * comps/flags cascade). DB record only — photo files on disk untouched.
     * Returns true if a row was deleted. */
    deleteItem(itemId) {
      const res = db.prepare('DELETE FROM items WHERE id = ?').run(itemId);
      return res.changes > 0;
    },

    /** Delete an item iff it has no photos left (post split/assign cleanup). */
    deleteItemIfEmpty(itemId) {
      const n = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE item_id = ?').get(itemId).n;
      if (Number(n) > 0) return false;
      db.prepare('DELETE FROM items WHERE id = ?').run(itemId); // photos/listings/comps/flags cascade
      return true;
    },

    /** Correction telemetry (§5.6): a user fixing the grouping is ground truth. */
    logCorrection(action, detail = {}) {
      return Number(
        db
          .prepare(
            "INSERT INTO grouping_events (created_at, folder, strategy, fallback_from, meta_json, groups_json, event) VALUES (?, NULL, NULL, NULL, ?, NULL, 'correction')"
          )
          .run(now(), JSON.stringify({ action, ...detail }))
          .lastInsertRowid
      );
    },

    /**
     * Misgrouping telemetry (§5.6 / integration plan P2.8): record each batch's
     * grouping outcome so real-world use accumulates tuning data. User
     * corrections are recorded separately via logCorrection above.
     */
    logGroupingEvent({ folder = null, strategy = null, fallbackFrom = null, meta = null, groups = [] } = {}) {
      const summary = groups.map((g) => ({
        groupId: g.groupId,
        photos: g.photos?.length ?? 0,
        confidence: g.confidence,
        autoAccept: g.autoAccept,
        flags: g.flags,
      }));
      return Number(
        db
          .prepare(
            "INSERT INTO grouping_events (created_at, folder, strategy, fallback_from, meta_json, groups_json, event) VALUES (?, ?, ?, ?, ?, ?, 'batch')"
          )
          .run(now(), folder, strategy, fallbackFrom, meta ? JSON.stringify(meta) : null, JSON.stringify(summary))
          .lastInsertRowid
      );
    },

    addFlag(itemId, type, detail = null) {
      return Number(
        db.prepare('INSERT INTO flags (item_id, type, detail, resolved) VALUES (?, ?, ?, 0)').run(itemId, type, detail).lastInsertRowid
      );
    },
    resolveFlag(flagId) {
      db.prepare('UPDATE flags SET resolved = 1 WHERE id = ?').run(flagId);
    },
    markSubmitted(itemId) {
      db.prepare('UPDATE listings SET submitted_at = ? WHERE item_id = ?').run(now(), itemId);
      db.prepare("UPDATE items SET status = 'submitted' WHERE id = ?").run(itemId);
    },
    /** Persist the last-autofill snapshot ({ at, fields, results }) — see
     * ui/main.js. null clears it. Stored whole; callers own the merge. */
    setLastFill(itemId, lastFill) {
      db.prepare('UPDATE items SET last_fill_json = ? WHERE id = ?').run(
        lastFill ? JSON.stringify(lastFill) : null,
        itemId
      );
    },
  };
  return api;
}

module.exports = { openStore, DEFAULT_DB };
