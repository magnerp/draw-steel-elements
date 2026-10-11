import {App, TFile} from "obsidian";

export class Images {
	static async resolveImageSource(app: App, imgSrcRaw: string): Promise<string> {
		// Check if it's an Obsidian link: ![[image.png]] or [[image.png]]
		const obsidianLinkMatch = imgSrcRaw.match(/!?\[\[(.+?)\]\]/);
		if (obsidianLinkMatch) {
			const fileName = obsidianLinkMatch[1].split("|")[0];
			const file = app.metadataCache.getFirstLinkpathDest(fileName, '');
			if (file instanceof TFile) {
				return app.vault.getResourcePath(file);
			} else {
				throw new Error('Image file not found in vault.');
			}
		}

		// Check if it's a URL
		if (imgSrcRaw.match(/^https?:\/\//)) {
			return imgSrcRaw;
		}

		// Assume it's a vault path, or a file name/partial path resolved like a link
		const path = imgSrcRaw.trim();
		const file = app.vault.getAbstractFileByPath(path) ?? app.metadataCache.getFirstLinkpathDest(path, '');
		if (file instanceof TFile) {
			return app.vault.getResourcePath(file);
		} else {
			throw new Error('Image file not found in vault.');
		}
	}

    static async resolveImageSourceOrDefault(app: App, imgSrcRaw: string | null, defaultImgSrc: string): Promise<string> {
        return Images.resolveImageSource(app, imgSrcRaw ?? defaultImgSrc)
            .catch(() => Images.resolveImageSource(app, defaultImgSrc))
    }
}
