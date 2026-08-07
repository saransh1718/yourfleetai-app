import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";

// Storage shim backed by a real Supabase (Postgres) table called "kv_store".
// Every row is tied to the logged-in user's id, and the database itself
// (via Row Level Security) refuses to return or accept rows that don't
// belong to the current user — so one person can never see another's data,
// even if they tried. See README.md for the one-time table + policy setup.
if (typeof window !== "undefined") {
  window.storage = {
    async get(key) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Not signed in");
      const { data, error } = await supabase
        .from("kv_store")
        .select("value")
        .eq("key", key)
        .eq("user_id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Key not found");
      return { key, value: data.value };
    },
    async set(key, value) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("kv_store")
        .upsert(
          { key, value, user_id: auth.user.id, updated_at: new Date().toISOString() },
          { onConflict: "user_id,key" }
        );
      if (error) throw error;
      return { key, value };
    },
    async delete(key) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Not signed in");
      const { error } = await supabase.from("kv_store").delete().eq("key", key).eq("user_id", auth.user.id);
      if (error) throw error;
      return { key, deleted: true };
    },
    async list(prefix) {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("Not signed in");
      let query = supabase.from("kv_store").select("key").eq("user_id", auth.user.id);
      if (prefix) query = query.like("key", `${prefix}%`);
      const { data, error } = await query;
      if (error) throw error;
      return { keys: data.map((r) => r.key) };
    },
  };
}

// ---------- Google Fonts ----------
const FontImport = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap');
    * { box-sizing: border-box; }
    body { margin: 0; }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: #14161c; }
    ::-webkit-scrollbar-thumb { background: #2c303c; border-radius: 4px; }
    input:focus, select:focus, textarea:focus, button:focus-visible {
      outline: 2px solid #f2a93b !important;
      outline-offset: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
      * { animation: none !important; transition: none !important; }
    }
  `}</style>
);

// ---------- Design tokens ----------
const C = {
  bg: "#0f1116",
  surface: "#171a22",
  surface2: "#1d212b",
  border: "#2a2e3a",
  text: "#eceae4",
  muted: "#8b8f9c",
  faint: "#565b68",
  amber: "#f2a93b",
  amberDim: "#3a2e18",
  green: "#5fbf7a",
  greenDim: "#16241b",
  red: "#e2584b",
  redDim: "#2a1917",
};

const disp = { fontFamily: "'Oswald', sans-serif", letterSpacing: "0.02em" };
const mono = { fontFamily: "'JetBrains Mono', monospace" };

// ---------- Storage helpers ----------
const STORAGE_KEY = "tms-fleet-data";
const emptyData = { trucks: [], drivers: [], trips: [], fuel: [] };

function uid(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  d.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((d - now) / 86400000);
}

function fmtMoney(n) {
  const v = Number(n) || 0;
  return "₹" + v.toLocaleString("en-IN");
}

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ---------- Small UI primitives ----------
function Plate({ children, tone = "neutral" }) {
  const tones = {
    neutral: { bg: C.surface2, border: C.border, color: C.text },
    amber: { bg: C.amberDim, border: "#5a4525", color: C.amber },
    green: { bg: C.greenDim, border: "#265c37", color: C.green },
    red: { bg: C.redDim, border: "#5c2a24", color: C.red },
  };
  const t = tones[tone];
  return (
    <span
      style={{
        ...mono,
        display: "inline-block",
        fontSize: 12,
        fontWeight: 600,
        padding: "3px 9px",
        borderRadius: 4,
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
        letterSpacing: "0.03em",
      }}
    >
      {children}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div
      style={{
        background: C.surface,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: 20,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13 }}>
      <span style={{ color: C.muted, fontWeight: 500 }}>{label}</span>
      {children}
    </label>
  );
}

const inputStyle = {
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 6,
  padding: "9px 11px",
  color: C.text,
  fontSize: 14,
  fontFamily: "'Inter', sans-serif",
  width: "100%",
};

function Btn({ children, onClick, variant = "primary", type = "button", style }) {
  const variants = {
    primary: { background: C.amber, color: "#1a1305", border: "none" },
    ghost: { background: "transparent", color: C.text, border: `1px solid ${C.border}` },
    danger: { background: "transparent", color: C.red, border: `1px solid #4a2622` },
  };
  return (
    <button
      type={type}
      onClick={onClick}
      style={{
        ...variants[variant],
        padding: "9px 16px",
        borderRadius: 6,
        fontWeight: 600,
        fontSize: 13,
        cursor: "pointer",
        fontFamily: "'Inter', sans-serif",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function RouteDivider() {
  return (
    <div
      style={{
        height: 1,
        margin: "18px 0",
        backgroundImage: `repeating-linear-gradient(90deg, ${C.border} 0 10px, transparent 10px 18px)`,
      }}
    />
  );
}

function Empty({ title, hint }) {
  return (
    <div style={{ textAlign: "center", padding: "48px 20px", color: C.muted }}>
      <div style={{ ...disp, fontSize: 18, color: C.text, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13 }}>{hint}</div>
    </div>
  );
}

// ---------- Auth screen ----------
function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo("Account created. Check your email to confirm, then log in.");
        setMode("login");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    }
    setBusy(false);
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "'Inter', sans-serif", color: C.text }}>
      <FontImport />
      <div style={{ width: "100%", maxWidth: 380 }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ ...disp, fontSize: 24, fontWeight: 700, letterSpacing: "0.04em" }}>
            YOURFLEET<span style={{ color: C.amber }}>AI</span>
          </div>
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4, ...mono }}>TRANSPORT MGMT</div>
        </div>
        <Card>
          <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
            <Btn variant={mode === "login" ? "primary" : "ghost"} onClick={() => setMode("login")} style={{ flex: 1 }}>
              Log in
            </Btn>
            <Btn variant={mode === "signup" ? "primary" : "ghost"} onClick={() => setMode("signup")} style={{ flex: 1 }}>
              Sign up
            </Btn>
          </div>
          <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
            <Field label="Email">
              <input style={inputStyle} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            <Field label="Password">
              <input style={inputStyle} type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </Field>
            {error && <div style={{ fontSize: 13, color: C.red }}>{error}</div>}
            {info && <div style={{ fontSize: 13, color: C.green }}>{info}</div>}
            <Btn type="submit" style={{ marginTop: 4 }}>
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Log in"}
            </Btn>
          </form>
        </Card>
        <div style={{ textAlign: "center", fontSize: 12, color: C.faint, marginTop: 16 }}>
          Your data is private — only visible when you're logged in.
        </div>
      </div>
    </div>
  );
}

// ---------- Auth gate: decides Dashboard vs login screen ----------
export default function AuthGate() {
  const [session, setSession] = useState(undefined); // undefined = checking, null = signed out

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, ...disp }}>
        Loading…
      </div>
    );
  }
  if (!session) return <AuthScreen />;
  return <AppShell userEmail={session.user.email} />;
}

// ---------- Main App ----------
function AppShell({ userEmail }) {
  const [data, setData] = useState(emptyData);
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState("dashboard");
  const [modal, setModal] = useState(null); // {type, item}
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved

  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) setData(JSON.parse(res.value));
      } catch (e) {
        // no existing data yet
      }
      setLoaded(true);
    })();
  }, []);

  const persist = useCallback(async (next) => {
    setData(next);
    setSaveState("saving");
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(next), false);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1200);
    } catch (e) {
      setSaveState("idle");
    }
  }, []);

  if (!loaded) {
    return (
      <div style={{ background: C.bg, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, ...disp }}>
        Loading fleet data…
      </div>
    );
  }

  const tabs = [
    { id: "dashboard", label: "Dashboard" },
    { id: "trucks", label: "Trucks" },
    { id: "drivers", label: "Drivers" },
    { id: "trips", label: "Trips" },
    { id: "fuel", label: "Fuel" },
    { id: "accounts", label: "Accounts" },
  ];

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter', sans-serif" }}>
      <FontImport />
      <div style={{ display: "flex", minHeight: "100vh" }}>
        {/* Sidebar */}
        <div
          style={{
            width: 220,
            flexShrink: 0,
            borderRight: `1px solid ${C.border}`,
            padding: "24px 14px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div style={{ padding: "0 10px 22px" }}>
            <div style={{ ...disp, fontSize: 20, fontWeight: 700, letterSpacing: "0.04em" }}>
              YOURFLEET<span style={{ color: C.amber }}>AI</span>
            </div>
            <div style={{ fontSize: 11, color: C.faint, marginTop: 2, ...mono }}>TRANSPORT MGMT</div>
          </div>
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                textAlign: "left",
                padding: "10px 12px",
                borderRadius: 6,
                border: "none",
                background: tab === t.id ? C.surface2 : "transparent",
                color: tab === t.id ? C.amber : C.muted,
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                borderLeft: tab === t.id ? `2px solid ${C.amber}` : "2px solid transparent",
              }}
            >
              {t.label}
            </button>
          ))}
          <div style={{ marginTop: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 11, color: C.faint }}>
              {saveState === "saving" ? "Saving…" : saveState === "saved" ? "✓ Saved" : "Autosaves to your account"}
            </div>
            <div style={{ fontSize: 11, color: C.faint, ...mono, wordBreak: "break-all" }}>{userEmail}</div>
            <Btn variant="ghost" onClick={() => supabase.auth.signOut()} style={{ fontSize: 12, padding: "7px 12px" }}>
              Sign out
            </Btn>
          </div>
        </div>

        {/* Main */}
        <div style={{ flex: 1, padding: "28px 36px", maxWidth: 1100 }}>
          {tab === "dashboard" && <Dashboard data={data} setTab={setTab} />}
          {tab === "trucks" && <Trucks data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "drivers" && <Drivers data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "trips" && <Trips data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "fuel" && <Fuel data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "accounts" && <Accounts data={data} />}
        </div>
      </div>
    </div>
  );
}

// ---------- Dashboard ----------
function Dashboard({ data, setTab }) {
  const activeTrucks = data.trucks.filter((t) => t.status === "active").length;
  const ongoingTrips = data.trips.filter((t) => t.status === "ongoing").length;
  const pendingAmt = data.trips
    .filter((t) => t.paymentStatus !== "paid")
    .reduce((s, t) => s + (Number(t.freight) || 0), 0);
  const profitTotal = data.trips.reduce((s, t) => {
    const p = (Number(t.freight) || 0) - (Number(t.expenses) || 0);
    return s + p;
  }, 0);

  const alerts = [];
  data.trucks.forEach((t) => {
    [
      ["insuranceExpiry", "Insurance"],
      ["fitnessExpiry", "Fitness Certificate"],
      ["permitExpiry", "Permit"],
      ["pollutionExpiry", "Pollution Certificate"],
    ].forEach(([key, label]) => {
      const d = daysUntil(t[key]);
      if (d !== null && d <= 30) {
        alerts.push({ truck: t.reg, label, days: d });
      }
    });
  });
  alerts.sort((a, b) => a.days - b.days);

  return (
    <div>
      <Header title="Dashboard" subtitle="Fleet overview at a glance" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
        <StatCard label="Active Trucks" value={activeTrucks} total={data.trucks.length} onClick={() => setTab("trucks")} />
        <StatCard label="Ongoing Trips" value={ongoingTrips} total={data.trips.length} onClick={() => setTab("trips")} />
        <StatCard label="Pending Payments" value={fmtMoney(pendingAmt)} onClick={() => setTab("accounts")} />
        <StatCard
          label="Net Profit (all trips)"
          value={fmtMoney(profitTotal)}
          tone={profitTotal >= 0 ? "green" : "red"}
          onClick={() => setTab("accounts")}
        />
      </div>

      <Card>
        <div style={{ ...disp, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Document Alerts</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>Expiring within 30 days, soonest first</div>
        {alerts.length === 0 ? (
          <Empty title="All clear" hint="No documents expiring in the next 30 days." />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {alerts.map((a, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  background: C.surface2,
                  borderRadius: 6,
                  border: `1px solid ${C.border}`,
                }}
              >
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <Plate>{a.truck}</Plate>
                  <span style={{ fontSize: 13, color: C.muted }}>{a.label}</span>
                </div>
                <Plate tone={a.days < 0 ? "red" : a.days <= 7 ? "red" : "amber"}>
                  {a.days < 0 ? `Expired ${Math.abs(a.days)}d ago` : a.days === 0 ? "Expires today" : `${a.days}d left`}
                </Plate>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Header({ title, subtitle, action }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22 }}>
      <div>
        <div style={{ ...disp, fontSize: 26, fontWeight: 700 }}>{title}</div>
        {subtitle && <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

function StatCard({ label, value, total, tone, onClick }) {
  const color = tone === "green" ? C.green : tone === "red" ? C.red : C.text;
  return (
    <Card style={{ cursor: onClick ? "pointer" : "default" }}>
      <div onClick={onClick}>
        <div style={{ fontSize: 12, color: C.muted, fontWeight: 600, marginBottom: 8 }}>{label}</div>
        <div style={{ ...disp, fontSize: 26, fontWeight: 700, color }}>
          {value}
          {total !== undefined && <span style={{ fontSize: 14, color: C.faint }}> / {total}</span>}
        </div>
      </div>
    </Card>
  );
}

// ---------- Trucks ----------
function Trucks({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, trucks: data.trucks.filter((t) => t.id !== id) });

  return (
    <div>
      <Header
        title="Trucks"
        subtitle={`${data.trucks.length} vehicles in fleet`}
        action={<Btn onClick={() => setModal({ type: "truck", item: null })}>+ Add Truck</Btn>}
      />
      {data.trucks.length === 0 ? (
        <Card>
          <Empty title="No trucks yet" hint="Add your first vehicle to start tracking documents and trips." />
        </Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {data.trucks.map((t) => {
            const driver = data.drivers.find((d) => d.id === t.driverId);
            return (
              <Card key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
                      <Plate tone="amber">{t.reg}</Plate>
                      <Plate tone={t.status === "active" ? "green" : "neutral"}>{t.status || "active"}</Plate>
                    </div>
                    <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 18, flexWrap: "wrap" }}>
                      <span>Driver: {driver ? driver.name : "Unassigned"}</span>
                      <span>Location: {t.location || "—"}</span>
                      <span>Fuel Efficiency: {t.fuelEfficiency ? `${t.fuelEfficiency} km/l` : "—"}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" onClick={() => setModal({ type: "truck", item: t })}>Edit</Btn>
                    <Btn variant="danger" onClick={() => remove(t.id)}>Remove</Btn>
                  </div>
                </div>
                <RouteDivider />
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, fontSize: 12 }}>
                  <ExpiryChip label="Insurance" date={t.insuranceExpiry} />
                  <ExpiryChip label="Fitness" date={t.fitnessExpiry} />
                  <ExpiryChip label="Permit" date={t.permitExpiry} />
                  <ExpiryChip label="Pollution" date={t.pollutionExpiry} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal?.type === "truck" && (
        <TruckModal item={modal.item} data={data} onClose={() => setModal(null)} onSave={(t) => {
          const exists = data.trucks.some((x) => x.id === t.id);
          const trucks = exists ? data.trucks.map((x) => (x.id === t.id ? t : x)) : [...data.trucks, t];
          persist({ ...data, trucks });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function ExpiryChip({ label, date }) {
  const d = daysUntil(date);
  let tone = "neutral";
  if (d !== null) tone = d < 0 ? "red" : d <= 30 ? "amber" : "green";
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 10px" }}>
      <div style={{ color: C.faint, marginBottom: 3 }}>{label}</div>
      <div style={{ color: tone === "red" ? C.red : tone === "amber" ? C.amber : C.text, fontWeight: 600, ...mono, fontSize: 12 }}>
        {fmtDate(date)}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 26, width: "100%", maxWidth: 520, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ ...disp, fontSize: 18, fontWeight: 700 }}>{title}</div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TruckModal({ item, data, onClose, onSave }) {
  const [f, setF] = useState(
    item || {
      id: uid("truck"),
      reg: "",
      rc: "",
      insuranceExpiry: "",
      fitnessExpiry: "",
      permitExpiry: "",
      pollutionExpiry: "",
      driverId: "",
      location: "",
      fuelEfficiency: "",
      status: "active",
    }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal title={item ? "Edit Truck" : "Add Truck"} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Registration Number"><input style={inputStyle} value={f.reg} onChange={set("reg")} placeholder="MH12AB3456" /></Field>
        <Field label="RC Number"><input style={inputStyle} value={f.rc} onChange={set("rc")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Insurance Expiry"><input type="date" style={inputStyle} value={f.insuranceExpiry} onChange={set("insuranceExpiry")} /></Field>
          <Field label="Fitness Expiry"><input type="date" style={inputStyle} value={f.fitnessExpiry} onChange={set("fitnessExpiry")} /></Field>
          <Field label="Permit Expiry"><input type="date" style={inputStyle} value={f.permitExpiry} onChange={set("permitExpiry")} /></Field>
          <Field label="Pollution Cert Expiry"><input type="date" style={inputStyle} value={f.pollutionExpiry} onChange={set("pollutionExpiry")} /></Field>
        </div>
        <Field label="Assigned Driver">
          <select style={inputStyle} value={f.driverId} onChange={set("driverId")}>
            <option value="">Unassigned</option>
            {data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Current Location"><input style={inputStyle} value={f.location} onChange={set("location")} /></Field>
          <Field label="Fuel Efficiency (km/l)"><input type="number" style={inputStyle} value={f.fuelEfficiency} onChange={set("fuelEfficiency")} /></Field>
        </div>
        <Field label="Status">
          <select style={inputStyle} value={f.status} onChange={set("status")}>
            <option value="active">Active</option>
            <option value="maintenance">In Maintenance</option>
            <option value="inactive">Inactive</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.reg && onSave(f)}>Save Truck</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Drivers ----------
function Drivers({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, drivers: data.drivers.filter((d) => d.id !== id) });

  return (
    <div>
      <Header
        title="Drivers"
        subtitle={`${data.drivers.length} drivers on record`}
        action={<Btn onClick={() => setModal({ type: "driver", item: null })}>+ Add Driver</Btn>}
      />
      {data.drivers.length === 0 ? (
        <Card><Empty title="No drivers yet" hint="Add a driver to assign them to trucks and trips." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {data.drivers.map((d) => (
            <Card key={d.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ ...disp, fontSize: 17, fontWeight: 600, marginBottom: 6 }}>{d.name}</div>
                  <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 18, flexWrap: "wrap" }}>
                    <span>Phone: {d.phone || "—"}</span>
                    <span>License: {d.license || "—"}</span>
                    <span>Salary: {d.salary ? fmtMoney(d.salary) + "/mo" : "—"}</span>
                    <span>Emergency: {d.emergencyContact || "—"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn variant="ghost" onClick={() => setModal({ type: "driver", item: d })}>Edit</Btn>
                  <Btn variant="danger" onClick={() => remove(d.id)}>Remove</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal?.type === "driver" && (
        <DriverModal item={modal.item} onClose={() => setModal(null)} onSave={(dr) => {
          const exists = data.drivers.some((x) => x.id === dr.id);
          const drivers = exists ? data.drivers.map((x) => (x.id === dr.id ? dr : x)) : [...data.drivers, dr];
          persist({ ...data, drivers });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function DriverModal({ item, onClose, onSave }) {
  const [f, setF] = useState(item || { id: uid("drv"), name: "", aadhaar: "", license: "", phone: "", emergencyContact: "", salary: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item ? "Edit Driver" : "Add Driver"} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Full Name"><input style={inputStyle} value={f.name} onChange={set("name")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Aadhaar Number"><input style={inputStyle} value={f.aadhaar} onChange={set("aadhaar")} /></Field>
          <Field label="Driving License"><input style={inputStyle} value={f.license} onChange={set("license")} /></Field>
          <Field label="Phone Number"><input style={inputStyle} value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Emergency Contact"><input style={inputStyle} value={f.emergencyContact} onChange={set("emergencyContact")} /></Field>
        </div>
        <Field label="Monthly Salary (₹)"><input type="number" style={inputStyle} value={f.salary} onChange={set("salary")} /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.name && onSave(f)}>Save Driver</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Trips ----------
function Trips({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, trips: data.trips.filter((t) => t.id !== id) });
  const sorted = [...data.trips].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div>
      <Header
        title="Trips"
        subtitle={`${data.trips.length} trips logged`}
        action={<Btn onClick={() => setModal({ type: "trip", item: null })}>+ New Trip</Btn>}
      />
      {sorted.length === 0 ? (
        <Card><Empty title="No trips yet" hint="Log a trip to track freight, expenses and profit." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sorted.map((t) => {
            const truck = data.trucks.find((x) => x.id === t.truckId);
            const driver = data.drivers.find((x) => x.id === t.driverId);
            const profit = (Number(t.freight) || 0) - (Number(t.expenses) || 0);
            return (
              <Card key={t.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                      <span style={{ ...disp, fontSize: 16, fontWeight: 600 }}>{t.pickup} → {t.destination}</span>
                      <Plate tone={t.status === "completed" ? "green" : "amber"}>{t.status || "ongoing"}</Plate>
                      <Plate tone={t.paymentStatus === "paid" ? "green" : "red"}>{t.paymentStatus === "paid" ? "Paid" : "Payment Pending"}</Plate>
                    </div>
                    <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 18, flexWrap: "wrap" }}>
                      <span>{truck ? truck.reg : "No truck"}</span>
                      <span>{driver ? driver.name : "No driver"}</span>
                      <span>Customer: {t.customer || "—"}</span>
                      <span>{fmtDate(t.date)}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" onClick={() => setModal({ type: "trip", item: t })}>Edit</Btn>
                    <Btn variant="danger" onClick={() => remove(t.id)}>Remove</Btn>
                  </div>
                </div>
                <RouteDivider />
                <div style={{ display: "flex", gap: 24, fontSize: 13 }}>
                  <span>Freight: <b style={{ ...mono }}>{fmtMoney(t.freight)}</b></span>
                  <span>Expenses: <b style={{ ...mono }}>{fmtMoney(t.expenses)}</b></span>
                  <span>Profit: <b style={{ ...mono, color: profit >= 0 ? C.green : C.red }}>{fmtMoney(profit)}</b></span>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal?.type === "trip" && (
        <TripModal item={modal.item} data={data} onClose={() => setModal(null)} onSave={(tr) => {
          const exists = data.trips.some((x) => x.id === tr.id);
          const trips = exists ? data.trips.map((x) => (x.id === tr.id ? tr : x)) : [...data.trips, tr];
          persist({ ...data, trips });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function TripModal({ item, data, onClose, onSave }) {
  const [f, setF] = useState(
    item || {
      id: uid("trip"),
      date: new Date().toISOString().slice(0, 10),
      truckId: "",
      driverId: "",
      pickup: "",
      destination: "",
      customer: "",
      freight: "",
      expenses: "",
      status: "ongoing",
      paymentStatus: "pending",
    }
  );
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item ? "Edit Trip" : "New Trip"} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Pickup Location"><input style={inputStyle} value={f.pickup} onChange={set("pickup")} /></Field>
          <Field label="Destination"><input style={inputStyle} value={f.destination} onChange={set("destination")} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Truck">
            <select style={inputStyle} value={f.truckId} onChange={set("truckId")}>
              <option value="">Select truck</option>
              {data.trucks.map((t) => <option key={t.id} value={t.id}>{t.reg}</option>)}
            </select>
          </Field>
          <Field label="Driver">
            <select style={inputStyle} value={f.driverId} onChange={set("driverId")}>
              <option value="">Select driver</option>
              {data.drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Customer"><input style={inputStyle} value={f.customer} onChange={set("customer")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Freight Amount (₹)"><input type="number" style={inputStyle} value={f.freight} onChange={set("freight")} /></Field>
          <Field label="Trip Expenses (₹)"><input type="number" style={inputStyle} value={f.expenses} onChange={set("expenses")} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Trip Date"><input type="date" style={inputStyle} value={f.date} onChange={set("date")} /></Field>
          <Field label="Status">
            <select style={inputStyle} value={f.status} onChange={set("status")}>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
            </select>
          </Field>
        </div>
        <Field label="Payment Status">
          <select style={inputStyle} value={f.paymentStatus} onChange={set("paymentStatus")}>
            <option value="pending">Pending</option>
            <option value="paid">Paid</option>
          </select>
        </Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.pickup && f.destination && onSave(f)}>Save Trip</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Fuel ----------
function Fuel({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, fuel: data.fuel.filter((f) => f.id !== id) });
  const sorted = [...data.fuel].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div>
      <Header
        title="Fuel Log"
        subtitle={`${data.fuel.length} entries`}
        action={<Btn onClick={() => setModal({ type: "fuel", item: null })}>+ Log Fuel</Btn>}
      />
      {sorted.length === 0 ? (
        <Card><Empty title="No fuel entries" hint="Log fill-ups to track mileage and flag abnormal consumption." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {sorted.map((f) => {
            const truck = data.trucks.find((t) => t.id === f.truckId);
            const expected = truck ? Number(truck.fuelEfficiency) : null;
            const actual = Number(f.mileage) || null;
            const abnormal = expected && actual && actual < expected * 0.8;
            return (
              <Card key={f.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <Plate tone="amber">{truck ? truck.reg : "—"}</Plate>
                    <span style={{ fontSize: 13, color: C.muted }}>{fmtDate(f.date)}</span>
                    <span style={{ fontSize: 13 }}>Filled: <b style={mono}>{f.liters} L</b></span>
                    <span style={{ fontSize: 13 }}>Cost: <b style={mono}>{fmtMoney(f.cost)}</b></span>
                    <span style={{ fontSize: 13 }}>Mileage: <b style={mono}>{f.mileage || "—"} km/l</b></span>
                    {abnormal && <Plate tone="red">Abnormal consumption</Plate>}
                  </div>
                  <Btn variant="danger" onClick={() => remove(f.id)}>Remove</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal?.type === "fuel" && (
        <FuelModal item={modal.item} data={data} onClose={() => setModal(null)} onSave={(fu) => {
          persist({ ...data, fuel: [...data.fuel, fu] });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function FuelModal({ data, onClose, onSave }) {
  const [f, setF] = useState({ id: uid("fuel"), date: new Date().toISOString().slice(0, 10), truckId: "", liters: "", cost: "", mileage: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Log Fuel Entry" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Truck">
          <select style={inputStyle} value={f.truckId} onChange={set("truckId")}>
            <option value="">Select truck</option>
            {data.trucks.map((t) => <option key={t.id} value={t.id}>{t.reg}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Date"><input type="date" style={inputStyle} value={f.date} onChange={set("date")} /></Field>
          <Field label="Liters Filled"><input type="number" style={inputStyle} value={f.liters} onChange={set("liters")} /></Field>
          <Field label="Fuel Cost (₹)"><input type="number" style={inputStyle} value={f.cost} onChange={set("cost")} /></Field>
          <Field label="Actual Mileage (km/l)"><input type="number" style={inputStyle} value={f.mileage} onChange={set("mileage")} /></Field>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.truckId && onSave(f)}>Save Entry</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Accounts ----------
function Accounts({ data }) {
  const totalFreight = data.trips.reduce((s, t) => s + (Number(t.freight) || 0), 0);
  const totalExpenses = data.trips.reduce((s, t) => s + (Number(t.expenses) || 0), 0);
  const totalFuel = data.fuel.reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const pending = data.trips.filter((t) => t.paymentStatus !== "paid");
  const netProfit = totalFreight - totalExpenses - totalFuel;

  return (
    <div>
      <Header title="Accounts & Finance" subtitle="Freight, expenses and profit summary" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 22 }}>
        <StatCard label="Total Freight" value={fmtMoney(totalFreight)} />
        <StatCard label="Trip Expenses" value={fmtMoney(totalExpenses)} />
        <StatCard label="Fuel Cost" value={fmtMoney(totalFuel)} />
        <StatCard label="Net Profit" value={fmtMoney(netProfit)} tone={netProfit >= 0 ? "green" : "red"} />
      </div>
      <Card>
        <div style={{ ...disp, fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Pending Customer Payments</div>
        <div style={{ fontSize: 12, color: C.muted, marginBottom: 14 }}>{pending.length} invoices outstanding</div>
        {pending.length === 0 ? (
          <Empty title="Nothing pending" hint="All trip payments are marked as received." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {pending.map((t) => (
              <div key={t.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: C.surface2, borderRadius: 6, border: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 13 }}>{t.customer || "Unnamed customer"} — {t.pickup} → {t.destination}</span>
                <b style={{ ...mono, color: C.red }}>{fmtMoney(t.freight)}</b>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
