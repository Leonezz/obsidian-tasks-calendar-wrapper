/** The file name of a vault path without its folders and without the .md extension. */
export function getFileTitle(path: string): string {
	if (path.includes("/")) path = path.substring(path.lastIndexOf("/") + 1);
	if (path.endsWith(".md")) path = path.substring(0, path.length - 3);
	return path;
}
