// Schéma de la base, sous forme de migrations successives. Ne jamais modifier une migration publiée :
// en ajouter une nouvelle à la fin.

// Schéma 1 : Ledger 1.0
function v1({ db }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS domains (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS recurring (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL CHECK (type IN ('in','out')),
      amount_cents INTEGER NOT NULL, freq TEXT NOT NULL CHECK (freq IN ('daily','weekly','monthly','yearly')),
      domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      next_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'paid', active INTEGER NOT NULL DEFAULT 1,
      anchor_day INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('in','out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '', date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
      kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','invest')),
      asset TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, unit_price REAL NOT NULL DEFAULT 0,
      recurring_id TEXT REFERENCES recurring(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS tx_date ON transactions(date);
    CREATE INDEX IF NOT EXISTS tx_domain ON transactions(domain_id);
    CREATE TABLE IF NOT EXISTS objectives (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, target_cents INTEGER NOT NULL,
      domain_id TEXT, deadline TEXT
    );
    CREATE TABLE IF NOT EXISTS asset_prices (
      asset TEXT PRIMARY KEY, price REAL NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

// Schéma 2 : Ledger 1.1 — abonnements, échéances, remboursements, comptes d'investissement, réglages.
// Exécuté clés étrangères désactivées (voir db.mjs) ; `transactions` est reconstruite, les autres tables
// reçoivent seulement des colonnes (ALTER TABLE ADD COLUMN), sans toucher à leurs liens.
function v2({ db, all, get, run, uid, fresh }) {
  const before = fresh ? null : {
    count: get("SELECT COUNT(*) n FROM transactions").n,
    balances: Object.fromEntries(all(`SELECT COALESCE(domain_id,'') d, SUM(CASE type WHEN 'in' THEN amount_cents ELSE -amount_cents END) b
      FROM transactions WHERE status = 'paid' GROUP BY COALESCE(domain_id,'')`).map((r) => [r.d, r.b])),
  };
  const legacy = fresh ? [] : all("SELECT * FROM transactions WHERE kind = 'invest' ORDER BY date, created_at, rowid");

  db.exec(`
    ALTER TABLE domains ADD COLUMN opening_cents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE domains ADD COLUMN opening_date TEXT;
    ALTER TABLE objectives ADD COLUMN metric TEXT NOT NULL DEFAULT 'net';
    ALTER TABLE objectives ADD COLUMN account_id TEXT;
    ALTER TABLE asset_prices ADD COLUMN name TEXT NOT NULL DEFAULT '';
    ALTER TABLE asset_prices ADD COLUMN class TEXT NOT NULL DEFAULT '';
    ALTER TABLE recurring ADD COLUMN kind TEXT NOT NULL DEFAULT 'subscription';
    ALTER TABLE recurring ADD COLUMN interval INTEGER NOT NULL DEFAULT 1;
    ALTER TABLE recurring ADD COLUMN counterparty TEXT NOT NULL DEFAULT '';
    ALTER TABLE recurring ADD COLUMN plan TEXT NOT NULL DEFAULT '';
    ALTER TABLE recurring ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    ALTER TABLE recurring ADD COLUMN start_date TEXT;
    ALTER TABLE recurring ADD COLUMN trial_end TEXT;
    ALTER TABLE recurring ADD COLUMN end_date TEXT;
    ALTER TABLE recurring ADD COLUMN amount_variable INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE recurring ADD COLUMN created_at TEXT;

    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

    CREATE TABLE inv_accounts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('pea','pea_pme','cto','crypto','autre')),
      broker TEXT NOT NULL DEFAULT '', fiscal_date TEXT, ceiling_cents INTEGER,
      initial_contributions_cents INTEGER NOT NULL DEFAULT 0,
      domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
      closed_on TEXT, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE inv_operations (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES inv_accounts(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('initial','deposit','withdrawal','buy','sell','dividend','interest','fee','tax','trade','split')),
      asset TEXT NOT NULL DEFAULT '', qty REAL NOT NULL DEFAULT 0, price REAL NOT NULL DEFAULT 0,
      fees_cents INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL,
      side TEXT, ratio REAL, notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (amount_cents >= 0 OR type = 'trade')
    );
    CREATE INDEX inv_ops_account ON inv_operations(account_id, asset, date);

    CREATE TABLE transactions_v2 (
      id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('in','out')),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
      domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
      category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
      description TEXT NOT NULL DEFAULT '', counterparty TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','pending')),
      kind TEXT NOT NULL DEFAULT 'cash' CHECK (kind IN ('cash','transfer','refund')),
      nature TEXT NOT NULL DEFAULT 'one_time' CHECK (nature IN ('one_time','subscription','recurring','installment')),
      recurring_id TEXT REFERENCES recurring(id) ON DELETE SET NULL,
      installment_group TEXT, installment_index INTEGER, installment_count INTEGER,
      refund_of TEXT REFERENCES transactions_v2(id) ON DELETE SET NULL,
      inv_op_id TEXT UNIQUE REFERENCES inv_operations(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO transactions_v2 (id, type, amount_cents, domain_id, category_id, description, date, status, kind, nature, recurring_id, created_at, updated_at)
      SELECT id, type, amount_cents,
        CASE WHEN domain_id IN (SELECT id FROM domains) THEN domain_id END,
        CASE WHEN category_id IN (SELECT id FROM categories) THEN category_id END,
        description, date, status,
        CASE kind WHEN 'invest' THEN 'transfer' ELSE 'cash' END,
        CASE WHEN recurring_id IN (SELECT id FROM recurring) THEN 'subscription' ELSE 'one_time' END,
        CASE WHEN recurring_id IN (SELECT id FROM recurring) THEN recurring_id END,
        created_at, updated_at
      FROM transactions;
    DROP TABLE transactions;
    ALTER TABLE transactions_v2 RENAME TO transactions;
    CREATE INDEX tx_date ON transactions(date);
    CREATE INDEX tx_domain ON transactions(domain_id);
    CREATE INDEX tx_recurring ON transactions(recurring_id);
    CREATE INDEX tx_installments ON transactions(installment_group);
  `);

  // Récurrences 1.0 : date de début = premier paiement créé ; une récurrence en pause devient résiliée
  // à sa prochaine échéance (rien n'est plus facturé à partir de cette date).
  run(`UPDATE recurring SET
        start_date = COALESCE((SELECT MIN(date) FROM transactions t WHERE t.recurring_id = recurring.id), next_date),
        created_at = COALESCE((SELECT MIN(date) FROM transactions t WHERE t.recurring_id = recurring.id), next_date),
        end_date = CASE active WHEN 0 THEN next_date END,
        active = 1`);

  // Investissements 1.0 (mouvements « invest ») → un compte-titres par business, avec versements/retraits
  // reliés à la trésorerie, pour garder à la fois l'historique de trésorerie et les positions.
  const accounts = new Map(), held = new Map();
  const domainName = (id) => (id && get("SELECT name FROM domains WHERE id = ?", id)?.name) || null;
  for (const t of legacy) {
    const key = t.domain_id || "";
    if (!accounts.has(key)) {
      const name = domainName(t.domain_id);
      const id = uid();
      run(`INSERT INTO inv_accounts (id, name, type, domain_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        id, name ? `${name} (migré)` : "Compte-titres (migré)", /crypt/i.test(name || "") ? "crypto" : "cto",
        t.domain_id && get("SELECT 1 FROM domains WHERE id = ?", t.domain_id) ? t.domain_id : null, accounts.size, t.created_at);
      accounts.set(key, id);
    }
    const account = accounts.get(key);
    const asset = String(t.asset || "").trim().toUpperCase() || "ACTIF";
    const hk = account + "|" + asset;
    const q = held.get(hk) || 0;
    const price = t.unit_price || (t.qty ? t.amount_cents / 100 / t.qty : 0);
    const op = (type, extra = {}) => {
      const id = uid() + Math.random().toString(36).slice(2, 5);
      const o = { asset: "", qty: 0, price: 0, notes: "", ...extra };
      run(`INSERT INTO inv_operations (id, account_id, date, type, asset, qty, price, amount_cents, notes, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        id, account, t.date, type, o.asset, o.qty, o.price, t.amount_cents, o.notes, t.created_at);
      return id;
    };
    if (t.type === "out") {
      const dep = op("deposit");
      op("buy", { asset, qty: t.qty || 0, price });
      held.set(hk, q + (t.qty || 0));
      run("UPDATE transactions SET inv_op_id = ?, description = CASE description WHEN '' THEN ? ELSE description END WHERE id = ?", dep, `Versement ${asset}`, t.id);
    } else {
      const sold = Math.min(t.qty || 0, q);
      op("sell", { asset, qty: sold, price, notes: sold < (t.qty || 0) ? `Quantité ramenée de ${t.qty} à ${sold} à la migration` : "" });
      held.set(hk, q - sold);
      const wd = op("withdrawal");
      run("UPDATE transactions SET inv_op_id = ? WHERE id = ?", wd, t.id);
    }
    run("INSERT OR IGNORE INTO asset_prices (asset, price) VALUES (?, ?)", asset, price);
  }

  // Contrôles : rien ne doit avoir bougé dans la trésorerie.
  if (before) {
    const count = get("SELECT COUNT(*) n FROM transactions").n;
    if (count !== before.count) throw new Error(`Migration 2 : ${before.count} mouvements avant, ${count} après.`);
    const after = Object.fromEntries(all(`SELECT COALESCE(domain_id,'') d, SUM(CASE type WHEN 'in' THEN amount_cents ELSE -amount_cents END) b
      FROM transactions WHERE status = 'paid' GROUP BY COALESCE(domain_id,'')`).map((r) => [r.d, r.b]));
    for (const [d, b] of Object.entries(before.balances)) {
      if ((after[d] ?? 0) !== b && get("SELECT 1 FROM domains WHERE id = ?", d)) throw new Error(`Migration 2 : solde modifié pour le business ${d}.`);
    }
  }
}

export const MIGRATIONS = [v1, v2];
