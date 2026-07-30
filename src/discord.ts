/**
 * Native Discord webhook formatting for build notifications.
 */

import type { CloudflareEvent } from "./types";
import {
	getBuildStatus,
	isProductionBranch,
	extractAuthorName,
	getCommitUrl,
	getDashboardUrl,
	extractBuildError,
} from "./helpers";

interface DiscordEmbedField {
	name: string;
	value: string;
	inline?: boolean;
}

interface DiscordEmbed {
	title: string;
	description?: string;
	url?: string;
	color: number;
	fields?: DiscordEmbedField[];
}

export interface DiscordPayload {
	embeds: DiscordEmbed[];
	allowed_mentions: {
		parse: [];
	};
}

const COLORS = {
	success: 0x57f287,
	failure: 0xed4245,
	cancelled: 0xfee75c,
	info: 0x5865f2,
} as const;

function buildContextFields(event: CloudflareEvent): DiscordEmbedField[] {
	const meta = event.payload?.buildTriggerMetadata;
	const commitUrl = getCommitUrl(event);
	const fields: DiscordEmbedField[] = [];

	if (meta?.branch) {
		fields.push({ name: "Branch", value: `\`${meta.branch}\``, inline: true });
	}

	if (meta?.commitHash) {
		const commitText = meta.commitHash.substring(0, 7);
		fields.push({
			name: "Commit",
			value: commitUrl ? `[${commitText}](${commitUrl})` : `\`${commitText}\``,
			inline: true,
		});
	}

	const authorName = extractAuthorName(meta?.author);
	if (authorName) {
		fields.push({ name: "Author", value: authorName, inline: true });
	}

	return fields;
}

function createPayload(embed: DiscordEmbed): DiscordPayload {
	return {
		embeds: [embed],
		allowed_mentions: { parse: [] },
	};
}

function buildSuccessMessage(
	event: CloudflareEvent,
	isProduction: boolean,
	previewUrl: string | null,
	liveUrl: string | null,
): DiscordPayload {
	const workerName = event.source?.workerName || "Worker";
	const dashboardUrl = getDashboardUrl(event);
	const title = isProduction ? "Production Deploy" : "Preview Deploy";
	const destinationUrl = isProduction
		? liveUrl || dashboardUrl
		: previewUrl || dashboardUrl;
	const destinationLabel = isProduction
		? liveUrl
			? "View Worker"
			: "View Build"
		: previewUrl
			? "View Preview"
			: "View Build";

	return createPayload({
		title: `✅ ${title}`,
		description: [
			`**${workerName}**`,
			destinationUrl ? `[${destinationLabel}](${destinationUrl})` : null,
		]
			.filter(Boolean)
			.join("\n"),
		...(destinationUrl && { url: destinationUrl }),
		color: COLORS.success,
		fields: buildContextFields(event),
	});
}

function buildFailureMessage(
	event: CloudflareEvent,
	logs: string[],
): DiscordPayload {
	const workerName = event.source?.workerName || "Worker";
	const dashboardUrl = getDashboardUrl(event);
	const error = extractBuildError(logs);

	return createPayload({
		title: "❌ Build Failed",
		description: [
			`**${workerName}**`,
			dashboardUrl ? `[View Logs](${dashboardUrl})` : null,
			`\`\`\`\n${error}\n\`\`\``,
		]
			.filter(Boolean)
			.join("\n"),
		...(dashboardUrl && { url: dashboardUrl }),
		color: COLORS.failure,
		fields: buildContextFields(event),
	});
}

function buildCancelledMessage(event: CloudflareEvent): DiscordPayload {
	const workerName = event.source?.workerName || "Worker";
	const dashboardUrl = getDashboardUrl(event);

	return createPayload({
		title: "⚠️ Build Cancelled",
		description: [
			`**${workerName}**`,
			dashboardUrl ? `[View Build](${dashboardUrl})` : null,
		]
			.filter(Boolean)
			.join("\n"),
		...(dashboardUrl && { url: dashboardUrl }),
		color: COLORS.cancelled,
		fields: buildContextFields(event),
	});
}

function buildFallbackMessage(event: CloudflareEvent): DiscordPayload {
	return createPayload({
		title: "📢 Build Event",
		description: event.type || "Unknown event",
		color: COLORS.info,
	});
}

export function buildDiscordPayload(
	event: CloudflareEvent,
	previewUrl: string | null,
	liveUrl: string | null,
	logs: string[],
): DiscordPayload {
	const status = getBuildStatus(event);
	const isProduction = isProductionBranch(
		event.payload?.buildTriggerMetadata?.branch,
	);

	if (status.isSucceeded) {
		return buildSuccessMessage(event, isProduction, previewUrl, liveUrl);
	}

	if (status.isFailed) {
		return buildFailureMessage(event, logs);
	}

	if (status.isCancelled) {
		return buildCancelledMessage(event);
	}

	return buildFallbackMessage(event);
}

export async function sendDiscordNotification(
	webhookUrl: string,
	payload: DiscordPayload,
): Promise<void> {
	const response = await fetch(webhookUrl, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		console.error("Discord API error:", response.status, await response.text());
	}
}
