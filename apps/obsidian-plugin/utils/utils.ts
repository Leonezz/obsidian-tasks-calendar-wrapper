/** The documented URI that opens the search pane of the vault on a tag, e.g. #work. */
export function tagSearchUri(vaultName: string, tag: string): string {
	return `obsidian://search?vault=${encodeURIComponent(vaultName)}&query=${encodeURIComponent("tag:" + tag)}`;
}
