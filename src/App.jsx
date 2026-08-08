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
const emptyData = { trucks: [], drivers: [], trips: [], fuel: [], maintenance: [], contracts: [], contractPayments: [], staff: [], expenses: [] };

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
        if (res && res.value) setData({ ...emptyData, ...JSON.parse(res.value) });
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
    { id: "maintenance", label: "Maintenance" },
    { id: "contracts", label: "Contracts" },
    { id: "staff", label: "Staff" },
    { id: "accounts", label: "Monthly Accounting" },
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
          {tab === "maintenance" && <Maintenance data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "contracts" && <Contracts data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "staff" && <Staff data={data} persist={persist} modal={modal} setModal={setModal} />}
          {tab === "accounts" && <MonthlyAccounting data={data} persist={persist} />}
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
                    <Btn variant="ghost" onClick={() => setModal({ type: "truckReport", item: t })}>Report</Btn>
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
      {modal?.type === "truckReport" && (
        <TruckReportModal truck={modal.item} data={data} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

function monthKey(dateStr) {
  if (!dateStr) return null;
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function monthLabel(key) {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

function TruckReportModal({ truck, data, onClose }) {
  const truckTrips = data.trips.filter((t) => t.truckId === truck.id);
  const truckFuel = data.fuel.filter((f) => f.truckId === truck.id);
  const truckMaint = data.maintenance.filter((m) => m.truckId === truck.id);
  const emi = Number(truck.monthlyEmi) || 0;

  const months = new Set();
  truckTrips.forEach((t) => t.date && months.add(monthKey(t.date)));
  truckFuel.forEach((f) => f.date && months.add(monthKey(f.date)));
  truckMaint.forEach((m) => m.date && months.add(monthKey(m.date)));
  const sortedMonths = [...months].filter(Boolean).sort().reverse();

  const rows = sortedMonths.map((key) => {
    const trips = truckTrips.filter((t) => monthKey(t.date) === key);
    const fuel = truckFuel.filter((f) => monthKey(f.date) === key);
    const maint = truckMaint.filter((m) => monthKey(m.date) === key);
    const revenue = trips.reduce((s, t) => s + (Number(t.freight) || 0), 0);
    const fuelCost = fuel.reduce((s, f) => s + (Number(f.cost) || 0), 0);
    const maintCost = maint.reduce((s, m) => s + (Number(m.cost) || 0), 0);
    const profit = revenue - fuelCost - maintCost - emi;
    return { key, tripCount: trips.length, revenue, fuelCost, maintCost, emi, profit };
  });

  const totals = rows.reduce(
    (acc, r) => ({
      tripCount: acc.tripCount + r.tripCount,
      revenue: acc.revenue + r.revenue,
      fuelCost: acc.fuelCost + r.fuelCost,
      maintCost: acc.maintCost + r.maintCost,
      emi: acc.emi + r.emi,
      profit: acc.profit + r.profit,
    }),
    { tripCount: 0, revenue: 0, fuelCost: 0, maintCost: 0, emi: 0, profit: 0 }
  );

  const currentKey = new Date().toISOString().slice(0, 7);
  const currentRow = rows.find((r) => r.key === currentKey);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 26, width: "100%", maxWidth: 760, maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div>
            <div style={{ ...disp, fontSize: 20, fontWeight: 700 }}>Truck Report</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>
              <Plate tone="amber">{truck.reg}</Plate>
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.muted, fontSize: 20, cursor: "pointer" }}>×</button>
        </div>

        <RouteDivider />

        <div style={{ ...disp, fontSize: 14, fontWeight: 600, marginBottom: 10, color: C.muted }}>THIS MONTH</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 26 }}>
          <MiniStat label="Trips" value={currentRow ? currentRow.tripCount : 0} />
          <MiniStat label="Revenue" value={fmtMoney(currentRow ? currentRow.revenue : 0)} />
          <MiniStat label="Fuel" value={fmtMoney(currentRow ? currentRow.fuelCost : 0)} />
          <MiniStat label="Maintenance" value={fmtMoney(currentRow ? currentRow.maintCost : 0)} />
          <MiniStat
            label="Profit"
            value={fmtMoney(currentRow ? currentRow.profit : -emi)}
            tone={(currentRow ? currentRow.profit : -emi) >= 0 ? "green" : "red"}
          />
        </div>

        <div style={{ ...disp, fontSize: 14, fontWeight: 600, marginBottom: 10, color: C.muted }}>ALL-TIME TOTAL</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 26 }}>
          <MiniStat label="Trips" value={totals.tripCount} />
          <MiniStat label="Revenue" value={fmtMoney(totals.revenue)} />
          <MiniStat label="Fuel" value={fmtMoney(totals.fuelCost)} />
          <MiniStat label="Maintenance" value={fmtMoney(totals.maintCost)} />
          <MiniStat label="Net Profit" value={fmtMoney(totals.profit)} tone={totals.profit >= 0 ? "green" : "red"} />
        </div>

        <div style={{ ...disp, fontSize: 14, fontWeight: 600, marginBottom: 10, color: C.muted }}>MONTHLY BREAKDOWN</div>
        {rows.length === 0 ? (
          <Empty title="No activity yet" hint="Log trips, fuel or maintenance for this truck to see monthly numbers." />
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 0.6fr 1fr 1fr 1fr 1fr 1fr", gap: 8, fontSize: 11, color: C.faint, padding: "0 12px", fontWeight: 600 }}>
              <span>MONTH</span><span>TRIPS</span><span>REVENUE</span><span>FUEL</span><span>MAINT.</span><span>EMI</span><span>PROFIT</span>
            </div>
            {rows.map((r) => (
              <div
                key={r.key}
                style={{
                  display: "grid", gridTemplateColumns: "1fr 0.6fr 1fr 1fr 1fr 1fr 1fr", gap: 8,
                  background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", fontSize: 13, alignItems: "center",
                }}
              >
                <span style={{ fontWeight: 600 }}>{monthLabel(r.key)}</span>
                <span style={mono}>{r.tripCount}</span>
                <span style={mono}>{fmtMoney(r.revenue)}</span>
                <span style={mono}>{fmtMoney(r.fuelCost)}</span>
                <span style={mono}>{fmtMoney(r.maintCost)}</span>
                <span style={mono}>{fmtMoney(r.emi)}</span>
                <span style={{ ...mono, color: r.profit >= 0 ? C.green : C.red, fontWeight: 600 }}>{fmtMoney(r.profit)}</span>
              </div>
            ))}
          </div>
        )}
        {emi === 0 && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 14 }}>
            Tip: add a monthly EMI on this truck's Edit form to see accurate profit after loan payments.
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone }) {
  const color = tone === "green" ? C.green : tone === "red" ? C.red : C.text;
  return (
    <div style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 4 }}>{label}</div>
      <div style={{ ...mono, fontSize: 15, fontWeight: 600, color }}>{value}</div>
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
      monthlyEmi: "",
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
        <Field label="Monthly EMI (₹)"><input type="number" style={inputStyle} value={f.monthlyEmi} onChange={set("monthlyEmi")} placeholder="0 if no loan" /></Field>
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

// ---------- Maintenance ----------
const MAINTENANCE_TYPES = ["Engine Oil", "Tyres", "Periodic Service", "Battery", "Brakes", "Other"];

function Maintenance({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, maintenance: data.maintenance.filter((m) => m.id !== id) });
  const sorted = [...data.maintenance].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  return (
    <div>
      <Header
        title="Maintenance"
        subtitle={`${data.maintenance.length} records`}
        action={<Btn onClick={() => setModal({ type: "maintenance", item: null })}>+ Log Maintenance</Btn>}
      />
      {sorted.length === 0 ? (
        <Card><Empty title="No maintenance logged" hint="Track service, tyres, oil changes and repairs per truck." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {sorted.map((m) => {
            const truck = data.trucks.find((t) => t.id === m.truckId);
            return (
              <Card key={m.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
                    <Plate tone="amber">{truck ? truck.reg : "—"}</Plate>
                    <span style={{ fontSize: 13, color: C.muted }}>{fmtDate(m.date)}</span>
                    <Plate>{m.type}</Plate>
                    <span style={{ fontSize: 13 }}>Cost: <b style={mono}>{fmtMoney(m.cost)}</b></span>
                    {m.notes && <span style={{ fontSize: 13, color: C.muted }}>{m.notes}</span>}
                  </div>
                  <Btn variant="danger" onClick={() => remove(m.id)}>Remove</Btn>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {modal?.type === "maintenance" && (
        <MaintenanceModal data={data} onClose={() => setModal(null)} onSave={(m) => {
          persist({ ...data, maintenance: [...data.maintenance, m] });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function MaintenanceModal({ data, onClose, onSave }) {
  const [f, setF] = useState({ id: uid("maint"), date: new Date().toISOString().slice(0, 10), truckId: "", type: MAINTENANCE_TYPES[0], cost: "", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Log Maintenance" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Truck">
          <select style={inputStyle} value={f.truckId} onChange={set("truckId")}>
            <option value="">Select truck</option>
            {data.trucks.map((t) => <option key={t.id} value={t.id}>{t.reg}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Date"><input type="date" style={inputStyle} value={f.date} onChange={set("date")} /></Field>
          <Field label="Type">
            <select style={inputStyle} value={f.type} onChange={set("type")}>
              {MAINTENANCE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Cost (₹)"><input type="number" style={inputStyle} value={f.cost} onChange={set("cost")} /></Field>
        <Field label="Notes (optional)"><input style={inputStyle} value={f.notes} onChange={set("notes")} placeholder="e.g. Front tyres replaced" /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.truckId && f.cost && onSave(f)}>Save Record</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Contracts ----------
const PAYMENT_TYPES = ["Fixed Monthly", "Per Trip", "Per KM", "Custom"];

function Contracts({ data, persist, modal, setModal }) {
  const remove = (id) => persist({
    ...data,
    contracts: data.contracts.filter((c) => c.id !== id),
    contractPayments: data.contractPayments.filter((p) => p.contractId !== id),
  });

  return (
    <div>
      <Header
        title="Contracts"
        subtitle={`${data.contracts.length} active contracts`}
        action={<Btn onClick={() => setModal({ type: "contract", item: null })}>+ New Contract</Btn>}
      />
      {data.contracts.length === 0 ? (
        <Card><Empty title="No contracts yet" hint="Add a contract to track assigned trucks and payments." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {data.contracts.map((c) => {
            const trucks = data.trucks.filter((t) => (c.trucksAssigned || []).includes(t.id));
            const payments = data.contractPayments.filter((p) => p.contractId === c.id);
            const received = payments.filter((p) => p.direction === "received").reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const invested = payments.filter((p) => p.direction === "investment").reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const due = (Number(c.contractValue) || 0) - received;
            return (
              <Card key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
                  <div>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                      <span style={{ ...disp, fontSize: 17, fontWeight: 600 }}>{c.name}</span>
                      <Plate>{c.paymentType}</Plate>
                    </div>
                    <div style={{ fontSize: 13, color: C.muted }}>Customer: {c.customer || "—"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <Btn variant="ghost" onClick={() => setModal({ type: "contractPayment", item: { contractId: c.id } })}>+ Payment</Btn>
                    <Btn variant="ghost" onClick={() => setModal({ type: "contract", item: c })}>Edit</Btn>
                    <Btn variant="danger" onClick={() => remove(c.id)}>Remove</Btn>
                  </div>
                </div>
                <RouteDivider />
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 12 }}>
                  Trucks assigned: {trucks.length === 0 ? "None" : trucks.map((t) => t.reg).join(", ")}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                  <MiniStat label="Contract Value" value={fmtMoney(c.contractValue)} />
                  <MiniStat label="Received" value={fmtMoney(received)} tone="green" />
                  <MiniStat label="Due" value={fmtMoney(due)} tone={due > 0 ? "red" : "green"} />
                  <MiniStat label="Your Investment" value={fmtMoney(invested)} />
                </div>
                {payments.length > 0 && (
                  <div style={{ marginTop: 14, display: "grid", gap: 6 }}>
                    {payments.slice().reverse().slice(0, 5).map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.muted, padding: "6px 10px", background: C.surface2, borderRadius: 6 }}>
                        <span>{fmtDate(p.date)} · {p.direction === "received" ? "Payment received" : "Investment made"}{p.notes ? ` — ${p.notes}` : ""}</span>
                        <b style={{ ...mono, color: p.direction === "received" ? C.green : C.text }}>{fmtMoney(p.amount)}</b>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {modal?.type === "contract" && (
        <ContractModal item={modal.item} data={data} onClose={() => setModal(null)} onSave={(c) => {
          const exists = data.contracts.some((x) => x.id === c.id);
          const contracts = exists ? data.contracts.map((x) => (x.id === c.id ? c : x)) : [...data.contracts, c];
          persist({ ...data, contracts });
          setModal(null);
        }} />
      )}
      {modal?.type === "contractPayment" && (
        <ContractPaymentModal contractId={modal.item.contractId} onClose={() => setModal(null)} onSave={(p) => {
          persist({ ...data, contractPayments: [...data.contractPayments, p] });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function ContractModal({ item, data, onClose, onSave }) {
  const [f, setF] = useState(item || { id: uid("contract"), name: "", customer: "", trucksAssigned: [], paymentType: PAYMENT_TYPES[0], contractValue: "", startDate: new Date().toISOString().slice(0, 10), notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const toggleTruck = (id) => {
    const cur = f.trucksAssigned || [];
    setF({ ...f, trucksAssigned: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <Modal title={item ? "Edit Contract" : "New Contract"} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Contract Name"><input style={inputStyle} value={f.name} onChange={set("name")} placeholder="e.g. Reliance Retail — Pune Route" /></Field>
        <Field label="Customer"><input style={inputStyle} value={f.customer} onChange={set("customer")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Payment Type">
            <select style={inputStyle} value={f.paymentType} onChange={set("paymentType")}>
              {PAYMENT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Contract Value (₹)"><input type="number" style={inputStyle} value={f.contractValue} onChange={set("contractValue")} /></Field>
        </div>
        <Field label="Start Date"><input type="date" style={inputStyle} value={f.startDate} onChange={set("startDate")} /></Field>
        <Field label="Trucks Assigned">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "8px 0" }}>
            {data.trucks.length === 0 && <span style={{ fontSize: 12, color: C.faint }}>No trucks added yet</span>}
            {data.trucks.map((t) => {
              const active = (f.trucksAssigned || []).includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTruck(t.id)}
                  style={{
                    ...mono, fontSize: 12, fontWeight: 600, padding: "5px 10px", borderRadius: 5, cursor: "pointer",
                    background: active ? C.amberDim : C.surface2,
                    border: `1px solid ${active ? "#5a4525" : C.border}`,
                    color: active ? C.amber : C.muted,
                  }}
                >
                  {t.reg}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Notes (optional)"><input style={inputStyle} value={f.notes} onChange={set("notes")} /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.name && onSave(f)}>Save Contract</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

function ContractPaymentModal({ contractId, onClose, onSave }) {
  const [f, setF] = useState({ id: uid("cpay"), contractId, date: new Date().toISOString().slice(0, 10), amount: "", direction: "received", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title="Log Contract Payment" onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Type">
          <select style={inputStyle} value={f.direction} onChange={set("direction")}>
            <option value="received">Payment received from customer</option>
            <option value="investment">Investment made by me</option>
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Date"><input type="date" style={inputStyle} value={f.date} onChange={set("date")} /></Field>
          <Field label="Amount (₹)"><input type="number" style={inputStyle} value={f.amount} onChange={set("amount")} /></Field>
        </div>
        <Field label="Notes (optional)"><input style={inputStyle} value={f.notes} onChange={set("notes")} /></Field>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.amount && onSave(f)}>Save</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Staff ----------
function Staff({ data, persist, modal, setModal }) {
  const remove = (id) => persist({ ...data, staff: data.staff.filter((s) => s.id !== id) });
  const totalMonthly = data.staff.reduce((s, x) => s + (Number(x.salaryBracket) || 0), 0);

  return (
    <div>
      <Header
        title="Staff"
        subtitle={`${data.staff.length} staff · ${fmtMoney(totalMonthly)}/month total`}
        action={<Btn onClick={() => setModal({ type: "staff", item: null })}>+ Add Staff</Btn>}
      />
      {data.staff.length === 0 ? (
        <Card><Empty title="No staff added" hint="Add office staff, accountants, or managers with their salary." /></Card>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {data.staff.map((s) => (
            <Card key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ ...disp, fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: C.muted, display: "flex", gap: 18, flexWrap: "wrap" }}>
                    <span>Role: {s.role || "—"}</span>
                    <span>Phone: {s.phone || "—"}</span>
                    <span>Salary: {fmtMoney(s.salaryBracket)}/mo</span>
                    <span>Since: {fmtDate(s.joinDate)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Btn variant="ghost" onClick={() => setModal({ type: "staff", item: s })}>Edit</Btn>
                  <Btn variant="danger" onClick={() => remove(s.id)}>Remove</Btn>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {modal?.type === "staff" && (
        <StaffModal item={modal.item} onClose={() => setModal(null)} onSave={(s) => {
          const exists = data.staff.some((x) => x.id === s.id);
          const staff = exists ? data.staff.map((x) => (x.id === s.id ? s : x)) : [...data.staff, s];
          persist({ ...data, staff });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function StaffModal({ item, onClose, onSave }) {
  const [f, setF] = useState(item || { id: uid("staff"), name: "", role: "", phone: "", salaryBracket: "", joinDate: new Date().toISOString().slice(0, 10) });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal title={item ? "Edit Staff" : "Add Staff"} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        <Field label="Full Name"><input style={inputStyle} value={f.name} onChange={set("name")} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Role"><input style={inputStyle} value={f.role} onChange={set("role")} placeholder="e.g. Accountant" /></Field>
          <Field label="Phone"><input style={inputStyle} value={f.phone} onChange={set("phone")} /></Field>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Monthly Salary (₹)"><input type="number" style={inputStyle} value={f.salaryBracket} onChange={set("salaryBracket")} /></Field>
          <Field label="Join Date"><input type="date" style={inputStyle} value={f.joinDate} onChange={set("joinDate")} /></Field>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <Btn onClick={() => f.name && onSave(f)}>Save Staff</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Monthly Accounting ----------
function MonthlyAccounting({ data, persist }) {
  const allMonths = new Set();
  data.trips.forEach((t) => t.date && allMonths.add(monthKey(t.date)));
  data.fuel.forEach((f) => f.date && allMonths.add(monthKey(f.date)));
  data.maintenance.forEach((m) => m.date && allMonths.add(monthKey(m.date)));
  data.contractPayments.forEach((p) => p.date && allMonths.add(monthKey(p.date)));
  data.expenses.forEach((e) => e.date && allMonths.add(monthKey(e.date)));
  allMonths.add(new Date().toISOString().slice(0, 7));
  const monthOptions = [...allMonths].sort().reverse();

  const [selectedMonth, setSelectedMonth] = useState(monthOptions[0]);
  const [modal, setModal] = useState(null);

  const inMonth = (dateStr) => monthKey(dateStr) === selectedMonth;

  // Income
  const tripRevenue = data.trips.filter((t) => inMonth(t.date)).reduce((s, t) => s + (Number(t.freight) || 0), 0);
  const contractReceived = data.contractPayments.filter((p) => p.direction === "received" && inMonth(p.date)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalIncome = tripRevenue + contractReceived;

  // Expenses
  const tripExpenses = data.trips.filter((t) => inMonth(t.date)).reduce((s, t) => s + (Number(t.expenses) || 0), 0);
  const fuelCost = data.fuel.filter((f) => inMonth(f.date)).reduce((s, f) => s + (Number(f.cost) || 0), 0);
  const maintCost = data.maintenance.filter((m) => inMonth(m.date)).reduce((s, m) => s + (Number(m.cost) || 0), 0);
  const truckEmis = data.trucks.reduce((s, t) => s + (Number(t.monthlyEmi) || 0), 0);
  const driverSalaries = data.drivers.reduce((s, d) => s + (Number(d.salary) || 0), 0);
  const staffSalaries = data.staff.reduce((s, x) => s + (Number(x.salaryBracket) || 0), 0);
  const contractInvestment = data.contractPayments.filter((p) => p.direction === "investment" && inMonth(p.date)).reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const otherExpenses = data.expenses.filter((e) => inMonth(e.date)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const totalExpenses = tripExpenses + fuelCost + maintCost + truckEmis + driverSalaries + staffSalaries + contractInvestment + otherExpenses;

  const net = totalIncome - totalExpenses;

  const monthExpenseEntries = data.expenses.filter((e) => inMonth(e.date)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const removeExpense = (id) => persist({ ...data, expenses: data.expenses.filter((e) => e.id !== id) });

  return (
    <div>
      <Header
        title="Monthly Accounting"
        subtitle="Every rupee earned and spent, in one place"
        action={
          <select
            style={{ ...inputStyle, width: "auto" }}
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
          >
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        }
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14, marginBottom: 22 }}>
        <StatCard label="Total Income" value={fmtMoney(totalIncome)} tone="green" />
        <StatCard label="Total Expenses" value={fmtMoney(totalExpenses)} tone="red" />
        <StatCard label="Net (Profit/Loss)" value={fmtMoney(net)} tone={net >= 0 ? "green" : "red"} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <div style={{ ...disp, fontSize: 15, fontWeight: 600, marginBottom: 12, color: C.green }}>INCOME</div>
          <LineItem label="Trip revenue (freight)" value={tripRevenue} />
          <LineItem label="Contract payments received" value={contractReceived} />
          <RouteDivider />
          <LineItem label="Total Income" value={totalIncome} bold />
        </Card>
        <Card>
          <div style={{ ...disp, fontSize: 15, fontWeight: 600, marginBottom: 12, color: C.red }}>EXPENSES</div>
          <LineItem label="Trip expenses" value={tripExpenses} />
          <LineItem label="Fuel" value={fuelCost} />
          <LineItem label="Maintenance" value={maintCost} />
          <LineItem label="Truck EMIs" value={truckEmis} />
          <LineItem label="Driver salaries" value={driverSalaries} />
          <LineItem label="Staff salaries" value={staffSalaries} />
          <LineItem label="Contract investment" value={contractInvestment} />
          <LineItem label="Other expenses" value={otherExpenses} />
          <RouteDivider />
          <LineItem label="Total Expenses" value={totalExpenses} bold />
        </Card>
      </div>

      <div style={{ marginTop: 22 }}>
        <Card>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div>
              <div style={{ ...disp, fontSize: 15, fontWeight: 600 }}>Other Expenses Log</div>
              <div style={{ fontSize: 12, color: C.muted }}>Rent, office costs, anything not tracked elsewhere — this month</div>
            </div>
            <Btn variant="ghost" onClick={() => setModal({ type: "expense", item: null })}>+ Log Expense</Btn>
          </div>
          {monthExpenseEntries.length === 0 ? (
            <div style={{ fontSize: 12, color: C.faint, padding: "14px 0 4px" }}>Nothing logged for {monthLabel(selectedMonth)} yet.</div>
          ) : (
            <div style={{ display: "grid", gap: 6, marginTop: 14 }}>
              {monthExpenseEntries.map((e) => (
                <ExpenseRow key={e.id} expense={e} onRemove={() => removeExpense(e.id)} />
              ))}
            </div>
          )}
        </Card>
      </div>

      {modal?.type === "expense" && (
        <ExpenseModalWrapper defaultDate={`${selectedMonth}-01`} onClose={() => setModal(null)} onSave={(exp) => {
          persist({ ...data, expenses: [...data.expenses, exp] });
          setModal(null);
        }} />
      )}
    </div>
  );
}

function LineItem({ label, value, bold }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", fontSize: bold ? 14 : 13 }}>
      <span style={{ color: bold ? C.text : C.muted, fontWeight: bold ? 700 : 400 }}>{label}</span>
      <span style={{ ...mono, fontWeight: bold ? 700 : 500 }}>{fmtMoney(value)}</span>
    </div>
  );
}

// Small wrapper so the expense log can persist without threading props
// through MonthlyAccounting's render tree — reads/writes the same
// storage key used everywhere else via a lightweight context-free approach.
function ExpenseRow({ expense, onRemove }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: C.muted, padding: "6px 10px", background: C.surface2, borderRadius: 6 }}>
      <span>{fmtDate(expense.date)} · {expense.category || "Other"}{expense.notes ? ` — ${expense.notes}` : ""}</span>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <b style={{ ...mono, color: C.text }}>{fmtMoney(expense.amount)}</b>
        <button onClick={onRemove} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 14 }}>×</button>
      </div>
    </div>
  );
}

function ExpenseModalWrapper({ defaultDate, onClose, onSave }) {
  return (
    <Modal title="Log Other Expense" onClose={onClose}>
      <ExpenseFormBody defaultDate={defaultDate} onSave={onSave} onCancel={onClose} />
    </Modal>
  );
}

const EXPENSE_CATEGORIES = ["Office Rent", "Toll/Parking", "Legal/Compliance", "Insurance (Office)", "Utilities", "Other"];

function ExpenseFormBody({ defaultDate, onSave, onCancel }) {
  const [f, setF] = useState({ id: uid("exp"), date: defaultDate, category: EXPENSE_CATEGORIES[0], amount: "", notes: "" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Date"><input type="date" style={inputStyle} value={f.date} onChange={set("date")} /></Field>
        <Field label="Category">
          <select style={inputStyle} value={f.category} onChange={set("category")}>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Amount (₹)"><input type="number" style={inputStyle} value={f.amount} onChange={set("amount")} /></Field>
      <Field label="Notes (optional)"><input style={inputStyle} value={f.notes} onChange={set("notes")} /></Field>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <Btn onClick={() => f.amount && onSave(f)}>Save Expense</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}
