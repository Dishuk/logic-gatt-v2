/**
 * Connection-flow panel (milestone: QR + mDNS + ping/pong).
 *
 * Shows a QR of the desktop's `ws://host:port` for the phone to scan, plus live
 * status and a ping/pong log. Auto-discovery (mDNS) needs no UI here — the phone
 * finds this desktop via `_logicgatt._tcp`.
 *
 * Rendered inside the "Connect Device" modal (see BackendTransportModal), so it
 * lays out as an inline block rather than a floating card.
 */

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { rpc, onConnectionEvent } from "../lib/rpc";
import type { ConnectionInfo, ConnectionEvent } from "@shared/rpc";

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

export function ConnectionPanel() {
	const [info, setInfo] = useState<ConnectionInfo | null>(null);
	const [peers, setPeers] = useState<string[]>([]);
	const [log, setLog] = useState<string[]>([]);

	useEffect(() => {
		const push = (m: string) =>
			setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 8));

		rpc.request.getConnectionInfo().then(setInfo).catch(() => {});

		const off = onConnectionEvent((e: ConnectionEvent) => {
			switch (e.type) {
				case "server-listening":
					push(`listening ${e.url}`);
					break;
				case "peer-connected":
					setPeers((p) => [...p, e.peerId]);
					push(`${e.peerId} connected`);
					break;
				case "peer-disconnected":
					setPeers((p) => p.filter((x) => x !== e.peerId));
					push(`${e.peerId} disconnected`);
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

			{info ? (
				<>
					<div style={{ background: "#fff", padding: 8, borderRadius: 6, width: "fit-content", margin: "0 auto 8px" }}>
						<QRCodeSVG value={info.url} size={160} />
					</div>
					<div style={{ textAlign: "center", marginBottom: 8, wordBreak: "break-all" }}>{info.url}</div>
					<div style={{ color: "#9ca3af", marginBottom: 6 }}>
						or auto-discover via mDNS (<code>_logicgatt._tcp</code>)
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
