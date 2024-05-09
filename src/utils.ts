import { promises as fs } from 'fs';
import { dirname, relative } from 'path';

export async function allFiles(path: string): Promise<string[]> {
    const files = await fs.readdir(path);

    const res: string[] = [];
    for (const file of files) {
        const filePath = `${path}/${file}`;

        const stat = await fs.lstat(filePath);
        if (stat.isDirectory()) {
            for (const subfile of await allFiles(filePath)) {
                res.push(subfile);
            }
        } else {
            res.push(filePath);
        }
    }

    return res;
}

export function sanitize(string: string): string {
    return string.replace(/[^a-zA-Z0-9]/g, '_');
}

export function camelize(str: string) {
    return str.split(/[^a-z0-9]/gi).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join('');
}

export function lowerCamelize(str: string): string {
    const camelized = module.exports.camelize(str);
    return camelized.slice(0, 1).toLowerCase() + camelized.slice(1);
}

export function categoryPath(assetDir: string, filepath: string): string[] {
    const dir = dirname(filepath);
    const trimmedDir = relative(assetDir, dir);
    return trimmedDir
        .split(/[\/\\]/g)
        .map(component => lowerCamelize(component))
        .filter(component => component.length > 0);
}
