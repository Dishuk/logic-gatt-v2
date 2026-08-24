/**
 * Connection-flow panel (milestone: QR + mDNS + ping/pong).
 *
 * Shows a QR for the phone to scan, plus live status and a ping/pong log.
 * Auto-discovery (mDNS) needs no UI here — the phone finds this desktop via
 * `_logicgatt._tcp`.
 *
 * The QR encodes `info.url`, which carries this run's session token; the address
 * printed underneath is `info.displayUrl`, which does not. A phone that arrives
 * without the token (mDNS, or a stale QR) shows up here as an approval prompt
 * instead of being adopted silently — see `bun/connection-server.ts`.
 *
 * Rendered inside the "Connect Device" modal (see BackendTransportModal), so it
 * lays out as an inline block rather than a floating card.
 */

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { rpc, onConnectionEvent } from "../lib/rpc";
import type { ConnectionInfo, ConnectionEvent, PendingPeer } from "@shared/rpc";

const card: React.CSSProperties = {
	width: "100%",
	padding: 14,
	borderRadius: 10,
	background: "#111827",
	color: "#e5e7eb",
	fontFamily: "ui-monospace, monospace",
	fontSize: 12,
	marginBottom: 12,
};

/** Approval prompt — amber, so it reads as a decision rather than status. */
const pendingCard: React.CSSProperties = {
	border: "1px solid #b45309",
	background: "#1f1503",
	borderRadius: 8,
	padding: 10,
	marginBottom: 10,
};

const pendingBtn: React.CSSProperties = {
	flex: 1,
	padding: "6px 10px",
	borderRadius: 6,
	border: "1px solid #4b5563",
	background: "#1f2937",
	color: "#e5e7eb",
	font: "inherit",
	cursor: "pointer",
};

export function ConnectionPanel() {
	const [info, setInfo] = useState<ConnectionInfo | null>(null);
	const [peers, setPeers] = useState<string[]>([]);
	const [awaiting, setAwaiting] = useState<PendingPeer | null>(null);
	const [log, setLog] = useState<string[]>([]);

	useEffect(() => {
		const push = (m: string) =>
			setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 8));

		rpc.request
			.getConnectionInfo()
			.then((i) => {
				setInfo(i);
				// A phone may already be waiting from before this modal was opened.
				setAwaiting(i.pendingPeer);
			})
			.catch(() => {});

		const off = onConnectionEvent((e: ConnectionEvent) => {
			switch (e.type) {
				case "server-listening":
					push(`listening ${e.url}`);
					break;
				case "peer-connected":
					setPeers((p) => [...p, e.peerId]);
					setAwaiting((a) => (a?.peerId === e.peerId ? null : a));
					push(`${e.peerId} connected`);
					break;
				case "peer-disconnected":
					setPeers((p) => p.filter((x) => x !== e.peerId));
					push(`${e.peerId} disconnected`);
					break;
				case "peer-pending":
					setAwaiting({ peerId: e.peerId, address: e.address });
					push(`${e.peerId} (${e.address}) is asking to connect`);
					break;
				case "peer-denied":
					setAwaiting((a) => (a?.peerId === e.peerId ? null : a));
					break;
				case "ping":
					push(`ping #${e.seq} from ${e.peerId}`);
					break;
				case "pong":
					push(`pong #${e.seq} to ${e.peerId}`);
					break;
				case "log":
					push(e.message);
					break;
			}
		});
		return off;
	}, []);

	const connected = peers.length > 0;

	return (
		<div style={card}>
			<div style={{ fontWeight: 700, marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
				<span>Connection</span>
				<span style={{ color: connected ? "#34d399" : "#9ca3af" }}>
					{connected ? `● ${peers.length} peer(s)` : "○ waiting"}
				</span>
			</div>

			{awaiting && (
				<div style={pendingCard}>
					<div style={{ fontWeight: 700, marginBottom: 4 }}>Allow this device?</div>
					<div style={{ color: "#d1d5db", marginBottom: 8 }}>
						{awaiting.address} connected without scanning the QR code. Allow it only if it is
						your phone.
					</div>
					<div style={{ display: "flex", gap: 8 }}>
						<button
							style={{ ...pendingBtn, background: "#065f46", borderColor: "#10b981" }}
							onClick={() => {
								void rpc.request.approvePeer({ peerId: awaiting.peerId }).catch(() => {});
							}}
						>
							Allow
						</button>
						<button
							style={pendingBtn}
							onClick={() => {
								void rpc.request.denyPeer({ peerId: awaiting.peerId }).catch(() => {});
							}}
						>
							Deny
						</button>
					</div>
				</div>
			)}

			{info ? (
				<>
					{/* The QR carries the session token; the printed address deliberately does not. */}
					<div style={{ background: "#fff", padding: 8, borderRadius: 6, width: "fit-content", margin: "0 auto 8px" }}>
						<QRCodeSVG value={info.url} size={160} />
					</div>
					<div style={{ textAlign: "center", marginBottom: 8, wordBreak: "break-all" }}>
						{info.displayUrl}
					</div>
					<div style={{ color: "#9ca3af", marginBottom: 6 }}>
						Scanning the QR connects straight away. Auto-discovery via mDNS (
						<code>_logicgatt._tcp</code>) also works, but asks for approval here first.
					</div>
				</>
			) : (
				<div style={{ color: "#9ca3af" }}>starting server…</div>
			)}

			<div style={{ borderTop: "1px solid #374151", paddingTop: 6, lineHeight: 1.5 }}>
				{log.length === 0 ? (
					<div style={{ color: "#6b7280" }}>no activity yet</div>
				) : (
					log.map((line, i) => (
						<div key={i} style={{ color: i === 0 ? "#e5e7eb" : "#9ca3af" }}>
							{line}
						</div>
					))
				)}
			</div>
		</div>
	);
}
