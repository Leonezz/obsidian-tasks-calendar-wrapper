import type * as React from "react";
import { getFileTitle } from "@tasks-calendar-wrapper/core";
import * as Icons from "../icons";

export type TagBadgeProps = {
	tag: string;
	color: string | undefined;
	onClick: (tag: string) => void;
};

export function TagBadge(props: TagBadgeProps) {
	const tag = props.tag;
	const tagText = tag.replace("#", "");
	const color = props.color;
	let style: Record<string, unknown>;
	if (color) {
		style = {
			"--tag-color": color,
			"--tag-background": `${color}1a`,
			zIndex: 9999,
		};
	} else {
		style = {
			"--tag-color": "var(--text-muted)",
			zIndex: 9999,
		};
	}
	return (
		<a
			href={tag}
			className={"tag"}
			target="_blank"
			rel="noopener"
			style={style}
			aria-label={tag}
			onClick={(e) => {
				e.stopPropagation();
				props.onClick(tag);
			}}
		>
			<div className="icon">{Icons.tagIcon}</div>
			<div className="label">{tagText}</div>
		</a>
	);
}

export type FileBadgeProps = {
	readonly filePath: string;
	readonly subPath: string;
};

export function FileBadge(props: FileBadgeProps) {
	const filePath = props.filePath;
	const fileName = getFileTitle(filePath);
	const subPath = props.subPath;
	return (
		<a className="file" aria-label={filePath}>
			<div className="icon">{Icons.fileIcon}</div>
			<div className="label">{fileName}</div>
			<span className="header">{subPath != "" ? "  >  " + subPath : subPath}</span>
		</a>
	);
}

export type BadgeProps = {
	readonly className: string;
	readonly ariaLabel: string;
	readonly label: string;
	readonly icon: JSX.Element;
	readonly onClick?: React.MouseEventHandler;
};

export function DateStatusBadge(props: BadgeProps) {
	const type = props.className;
	const aria_label = props.ariaLabel;
	const label = props.label;
	const icon = props.icon;
	return (
		<a className={type} aria-label={aria_label} onClick={props.onClick}>
			<div className="icon">{icon}</div>
			<div className="label">{label}</div>
		</a>
	);
}

export type ModifyBadgeProps = {
	readonly onClick: (evt: React.MouseEvent) => void;
};

export function ModifyBadge(props: ModifyBadgeProps) {
	return (
		<a className="modify" aria-label="Modify Task" onClick={props.onClick}>
			✏️
		</a>
	);
}
