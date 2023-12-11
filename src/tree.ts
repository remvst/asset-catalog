import { basename } from "path";
import { categoryPath } from "./utils";

export type Tree = Map<string, TreeOrPath>;
export type TreeOrPath = Tree | string;

export async function generateTree(dir: string, files: string[]): Promise<Tree> {
    const tree = new Map();

    for (const file of files) {
        let subtree = tree;
        for (const category of categoryPath(dir, file)) {
            if (!subtree.has(category)) {
                subtree.set(category, new Map());
            }
            subtree = subtree.get(category);
        }

        subtree.set(basename(file).replace('.file', ''), file);
    }

    return tree;
}
