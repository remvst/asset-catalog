#!/usr/bin/env node

import { promises as fs } from 'fs';
import sizeOf from 'image-size';
import { sanitize, basename, extension, allFiles, lowerCamelize, categoryPath } from './utils';
import { resolve, relative } from 'path';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';

type Tree = Map<string, TreeOrPath>;
type TreeOrPath = Tree | string;

function importName(png: string): string {
    let importName = png;
    importName = resolve(png);

    const prefix = resolve(__dirname + '/../../assets/textures/game/');
    const prefixIndex = importName.indexOf(prefix);
    if (prefixIndex >= 0) {
        importName = importName.slice(prefixIndex + prefix.length);
    }

    importName = sanitize(importName);
    return importName;
}

function generatedTemplateInterface(tree: Tree, name: string, indent: string = ''): string {
    let generated = '{\n';
    for (const [subname, item] of tree.entries()) {
        if (item instanceof Map) {
            const generatedSub = generatedTemplateInterface(item, subname, indent + '    ');
            generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub}`;
        } else {
            generated += indent + `    ${lowerCamelize(subname)}: T,\n`;
        }
    }
    generated += indent + '}\n';
    return generated;
}

async function generatedCreateCatalogFunction(tree: Tree): Promise<string> {
    async function rec(tree: Tree, indent: string = '') {
        let generated = '{\n';
        for (const [subname, item] of tree.entries()) {
            if (item instanceof Map) {
                const generatedSub = await rec(item, indent + '    ');
                generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub},\n`;
            } else {
                const dimensions = sizeOf(item);
                const stats = await fs.stat(item);
                generated += indent + `    ${lowerCamelize(subname)}: createItem({
                    path: ${importName(item)},
                    width: ${dimensions.width},
                    height: ${dimensions.height},
                    size: ${stats.size},
                }),\n`;
            }
        }
        generated += indent + '}';
        return generated;
    }

    let generated = '\n';
    generated += 'export function createTextureCatalog<T>(createItem: (opts: {path: string, width: number, height: number, size: number}) => T): TextureCatalog<T> {\n';
    generated += `    return ${await rec(tree, '   ')};\n`;
    generated += '}\n';
    return generated;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .options({
            'outFile': { 
                type: 'string', 
                default: '.', 
                alias: 'o', 
                describe: 'Directory to generate the files into',
            },
            'assetDir': { 
                type: 'string', 
                default: './package.json', 
                alias: 'a', 
                describe: 'package.json file to use for the version',
            }
        })
        .argv;

    const texturesRoot = argv.assetDir;
    const generatedTs = argv.outFile;
    try {
        await fs.rm(generatedTs, { 'recursive': true });
    } catch (e) {}

    const files = await allFiles(texturesRoot);
    const pngs = files.filter(file => extension(file) === 'png');

    const imports = [];

    const tree = new Map();

    for (const png of pngs) {
        let subtree = tree;
        for (const category of categoryPath(png)) {
            if (!subtree.has(category)) {
                subtree.set(category, new Map());
            }
            subtree = subtree.get(category);
        }

        subtree.set(basename(png).replace('.png', ''), png);

        const importPath = relative(__dirname + '/../assets', png).replace(/\\/g, '/');
        console.log(importPath);
        imports.push(`import ${importName(png)} from '${importPath}';`);
    }

    let generatedFileContent = '';
    generatedFileContent += imports.join('\n');
    generatedFileContent += '\n\n';
    generatedFileContent += 'export type TextureCatalog<T> = ' + generatedTemplateInterface(tree, 'TextureCatalog');
    generatedFileContent += '\n\n';
    generatedFileContent += await generatedCreateCatalogFunction(tree);

    await fs.writeFile(generatedTs, generatedFileContent);
}

main();
