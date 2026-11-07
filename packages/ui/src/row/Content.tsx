import * as React from "react";
import { useHost } from "../contexts";

export type ContentProps = { readonly display: string; readonly fileName: string };

export const sameContentProps = (prev: ContentProps, next: ContentProps): boolean =>
	prev.display === next.display && prev.fileName === next.fileName;

/**
 * Rendering markdown is the most expensive part of a row, so it only runs again when the text or the file changes.
 * Every reload creates new task objects, so without this every row was rendered again after each save (issue #63).
 * The host caches renders between list commits.
 */
export const Content = React.memo(function Content({ display, fileName }: ContentProps) {
	const host = useHost();
	return <a dangerouslySetInnerHTML={{ __html: host.renderMarkdown(display, fileName) }} />;
}, sameContentProps);
