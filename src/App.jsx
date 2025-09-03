// === Smart Business Card — Chat-first App.jsx ===
// === Purpose: chat-forward UX with an info view toggle (no router, no backend writes) ===

import { useState, useEffect } from "react";
import "./App.css";

// === Streaming hook ===
import { useChatStream } from "./hooks/useChatStream";


// --- Firestore ---
import { doc, onSnapshot, collection, query, orderBy } from "firebase/firestore";
import { db, storage, devAnonSignIn } from "./lib/firebase";
// --- Storage (admin-only upload; unchanged) ---
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

// === Helpers ===
function getBizIdFromUrl() {
  const u = new URL(window.location.href);
  const fromQuery = u.searchParams.get("biz");
  if (fromQuery) return fromQuery;
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg || "demo-plumbing"; // fallback
}

function getViewFromUrl() {
  const u = new URL(window.location.href);
  return u.searchParams.get("view") === "info" ? "info" : "chat";
}

export default function App() {
  // --- State: data ---
  const [biz, setBiz] = useState(null);
  const [services, setServices] = useState([]);

  // --- State: ui ---
  const [view, setView] = useState(getViewFromUrl()); // "chat" | "info"
  const [isAdmin, setIsAdmin] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedUrl, setUploadedUrl] = useState("");

  // --- State: chat stub ---
  const [messages, setMessages] = useState([
    // seed with a system-style greeting once biz loads
  ]);
  const [input, setInput] = useState("");

  // === Streaming chat (AI) ===
  const { send, abort, isLoading, text: streamText } = useChatStream();


  // === Apply theme variables when business data loads ===
  useEffect(() => {
    if (!biz) return;

    const root = document.documentElement;
    const brand = biz.brand || {};
    const typography = biz.typography || {};

    // Colors
    if (brand.primary) root.style.setProperty("--color-primary", brand.primary);
    if (brand.secondary) root.style.setProperty("--color-secondary", brand.secondary);
    if (brand.background) root.style.setProperty("--color-background", brand.background);
    if (brand.surface) root.style.setProperty("--color-surface", brand.surface);
    if (brand.text) root.style.setProperty("--color-text", brand.text);
    if (brand.accent) root.style.setProperty("--color-accent", brand.accent);

    // Typography
    if (typography.fontFamily) root.style.setProperty("--font-family", typography.fontFamily);
    if (typography.headingScale) root.style.setProperty("--heading-scale", typography.headingScale);

    // Shape + elevation
    if (biz.rounded) root.style.setProperty("--rounded", String(biz.rounded));
    if (biz.elevation != null) root.style.setProperty("--elevation", String(biz.elevation));
  }, [biz]);

  // === Firestore listeners ===
  useEffect(() => {
    const bizId = getBizIdFromUrl();

    const unsubBiz = onSnapshot(doc(db, "businesses", bizId), (snap) => {
      const data = snap.exists() ? snap.data() : null;
      setBiz(data);

// seed greeting when biz arrives
if (data) {
  setMessages([
    {
      role: "assistant",
      text: `Hi! I’m the business card for ${data.name}. I can chat about these services:`,
    },
    {
      role: "assistant",
      text:
        "Ask me anything—or pick an option below. I can also help book an appointment or collect details for a free quote.",
    },
  ]);
}
    });

    const servicesRef = collection(db, "businesses", bizId, "services");
    const q = query(servicesRef, orderBy("title"));
    const unsubServices = onSnapshot(q, (snap) => {
      setServices(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    return () => {
      unsubBiz();
      unsubServices();
    };
  }, []);

  // === Admin gate + dev-only anonymous auth ===
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const admin = params.get("admin") === "1";
    setIsAdmin(admin);
    if (admin) {
      devAnonSignIn().catch((err) => console.error("Anon sign-in failed", err));
    }
  }, []);

  // === Keep view in sync with URL param (no router) ===
  useEffect(() => {
    const onPop = () => setView(getViewFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function goToView(next) {
    const u = new URL(window.location.href);
    if (next === "info") u.searchParams.set("view", "info");
    else u.searchParams.delete("view");
    window.history.pushState({}, "", u.toString());
    setView(next);
  }

  // === Admin: dev logo upload handlers (unchanged except bizId from URL) ===
  async function handleLogoUpload(file) {
    if (!file) return;
    const bizId = getBizIdFromUrl();
    setUploading(true);
    try {
      const objectRef = storageRef(storage, `logos/${bizId}/logo.png`);
      await uploadBytes(objectRef, file, { contentType: file.type });
      const url = await getDownloadURL(objectRef);
      setUploadedUrl(url);
      alert(
        `Upload complete.\n\nCopy this URL into Firestore:\nbusinesses/${bizId}.logoUrl`
      );
    } catch (err) {
      console.error(err);
      alert(`Upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  }
  function onFileChange(e) {
    const file = e.target.files && e.target.files[0];
    if (file) handleLogoUpload(file);
  }

  // === Chat stubs ===
  function onQuickAction(type) {
    if (type === "book" && biz?.calendlyUrl) {
      window.open(biz.calendlyUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (type === "quote") {
      // Pre-fill the input with a prompt for the quote form
      setInput("I’d like a free quote for...");
      const el = document.getElementById("chat-input");
      if (el) el.focus();
    }
  }

  // === Send to /api/chat (streaming) ===
  function onSend(e) {
    e.preventDefault();
    const userText = input.trim();
    if (!userText) return;

    // Append the user message to UI immediately
    setMessages((m) => [...m, { role: "user", text: userText }]);
    setInput("");

    const bizId = getBizIdFromUrl();

    // Transform our UI messages ({role,text}) -> API format ({role,content})
    const history = messages.map((m) => ({ role: m.role, content: m.text }));
    const payload = [...history, { role: "user", content: userText }];

    // Stream from the server; streamText will update live via the hook
    send({
      bizId,
      messages: payload,
      onChunk: () => {
        // no-op: UI consumes streamText directly
      },
      onDone: () => {
        // When stream ends, commit the assistant message (from streamText) to history
        const finalText = streamText; // latest value from hook
        if (finalText && finalText.trim().length) {
          setMessages((m) => [...m, { role: "assistant", text: finalText }]);
        }
      },
      onError: (err) => {
        console.error(err);
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            text:
              "Sorry—there was a problem reaching the chat service. Please try again in a moment.",
          },
        ]);
      },
    });
  }

  // === Simple Quote form (mailto: fallback; no writes yet) ===
  function openMailtoQuote() {
    if (!biz?.email) {
      alert("This business has no email set yet.");
      return;
    }
    const subject = encodeURIComponent(`Free quote request for ${biz.name}`);
    const body = encodeURIComponent(
      `Hi ${biz.name},\n\nMy name is ____.\nService needed: ____\nDetails: ____\nPreferred date/time: ____\nPhone/email: ____\n\nThanks!`
    );
    window.location.href = `mailto:${biz.email}?subject=${subject}&body=${body}`;
  }

  // === Views ===
  const showChat = view === "chat";

  return (
    <div className="container">
      {!biz ? (
        <p>Loading business…</p>
      ) : (
        <>
          {/* --- Header (shared) --- */}
          <header>
            {biz.logoUrl && (
              <img src={biz.logoUrl} alt={`${biz.name} logo`} className="logo" />
            )}
            <h1>{biz.name}</h1>
            {biz.tagline && <p className="tagline">{biz.tagline}</p>}
          </header>

          {/* --- CHAT VIEW --- */}
          {showChat ? (
            <section className="chat">
              {/* Quick intro with services list */}

<div className="chat-feed">
  {messages.map((m, i) => {
    if (i === 0 && services.length > 0) {
      return (
        <div key={i}>
          <div className={`bubble ${m.role === "user" ? "user" : "bot"}`}>
            {m.text}
          </div>
          <div className="bubble bot">
            <ul style={{ margin: "6px 0 0 18px" }}>
              {services.map((s) => (
                <li key={s.id}>{s.title}</li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
    return (
      <div key={i} className={`bubble ${m.role === "user" ? "user" : "bot"}`}>
        {m.text}
      </div>
    );
  })}

  {/* Live streaming assistant bubble (appears while isLoading or when streamText has content) */}
  {(isLoading || (streamText && streamText.length > 0)) && (
    <div className="bubble bot">
      {streamText || "…"}
    </div>
  )}
</div>

{/* Chat input (now above the buttons) */}
<form className="chat-input-row" onSubmit={onSend}>
  <input
    id="chat-input"
    className="input"
    placeholder="Ask about pricing, availability, or a service…"
    value={input}
    onChange={(e) => setInput(e.target.value)}
    disabled={isLoading}
  />
  {!isLoading ? (
    <button className="btn" type="submit">Send</button>
  ) : (
    <button className="btn secondary" type="button" onClick={abort}>
      Stop
    </button>
  )}
</form>

{/* Quick actions */}
<div className="chat-actions">
  <button
    className="btn"
    onClick={() => onQuickAction("book")}
    disabled={!biz?.calendlyUrl}
    title={biz?.calendlyUrl ? "" : "No booking link configured yet."}
  >
    Book Appointment
  </button>
  <button className="btn" onClick={() => onQuickAction("quote")}>
    Get a Quote
  </button>
  <button className="linklike" onClick={() => goToView("info")}>
    View services & contact →
  </button>
</div>
              {/* Quote email helper */}
              <div className="quote-helper">
                <p className="muted">
                  Want a free quote now? Click below and your email client will
                  open with a pre-filled message.
                </p>
                <button className="btn secondary" onClick={openMailtoQuote}>
                  Compose Quote Email
                </button>
              </div>
            </section>
          ) : (
            /* --- INFO VIEW --- */
            <>
              <section className="contact">
                <h2>Contact</h2>
                <p>
                  <strong>Phone:</strong> {biz.phone}
                </p>
                <p>
                  <strong>Email:</strong> {biz.email}
                </p>
                {biz.website && (
                  <p>
                    <strong>Website:</strong>{" "}
                    <a href={biz.website} target="_blank" rel="noreferrer">
                      {biz.website}
                    </a>
                  </p>
                )}
                {biz.availabilityNote && (
                  <p>
                    <strong>Availability:</strong> {biz.availabilityNote}
                  </p>
                )}
                <button className="linklike" onClick={() => goToView("chat")}>
                  ← Back to chat
                </button>
              </section>

              <section className="services">
                <h2>Services</h2>
                <ul>
                  {services.map((s) => (
                    <li key={s.id} className="service">
                      <h3>{s.title}</h3>
                      {s.priceFrom != null && <p>From ${s.priceFrom}</p>}
                      {s.durationMin != null && (
                        <p>Duration: {s.durationMin} min</p>
                      )}
                      {s.description && <p>{s.description}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {/* --- Admin: Dev Uploader (unchanged) --- */}
          {isAdmin && (
            <section
              className="admin-uploader"
              style={{
                padding: "12px",
                border: "1px solid var(--color-surface,#ddd)",
                borderRadius: "8px",
                margin: "12px 0",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Dev Logo Uploader</h3>
              <p style={{ margin: "6px 0 12px" }}>
                Uploads to <code>logos/{getBizIdFromUrl()}/logo.png</code>.
                After upload, paste the URL into{" "}
                <code>businesses/{getBizIdFromUrl()}.logoUrl</code>.
              </p>

              <input
                type="file"
                accept="image/*"
                onChange={onFileChange}
                disabled={uploading}
              />
              {uploading && <p style={{ margin: "8px 0" }}>Uploading…</p>}

              {uploadedUrl && (
                <div className="upload-result" style={{ marginTop: "8px" }}>
                  <label
                    htmlFor="logoUrl"
                    style={{ display: "block", marginBottom: "4px" }}
                  >
                    Download URL
                  </label>
                  <input
                    id="logoUrl"
                    className="input"
                    value={uploadedUrl}
                    readOnly
                    onFocus={(e) => e.target.select()}
                    style={{ width: "100%" }}
                  />
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
