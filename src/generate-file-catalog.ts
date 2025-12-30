#!/usr/bin/env node

import {promises as fs} from 'fs';
import {allFiles, lowerCamelize, sanitize} from './utils';
import {basename, dirname, extname, relative, resolve} from 'path';
import yargs from 'yargs/yargs';
import {hideBin} from 'yargs/helpers';
import {generateTree, Tree} from './tree';

function importName(assetDir: string, file: string): string {
    let importName = file;
    importName = resolve(file);

    const prefix = resolve(assetDir);
    const prefixIndex = importName.indexOf(prefix);
    if (prefixIndex >= 0) {
        importName = importName.slice(prefixIndex + prefix.length);
    }

    importName = sanitize(importName);
    return importName;
}

function generatedTemplateInterface(tree: Tree, indent: string = ''): string {
    let generated = '{\n';
    for (const [subname, item] of tree.entries()) {
        if (item instanceof Map) {
            const generatedSub = generatedTemplateInterface(item, indent + '    ');
            generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub}`;
        } else {
            const name = basename(subname);
            generated += indent + `    ${lowerCamelize(name)}: T,\n`;
        }
    }
    generated += indent + '}\n';
    return generated;
}

async function generatedCreateCatalogFunction(assetDir: string, tree: Tree): Promise<string> {
    async function rec(tree: Tree, indent: string = '') {
        let generated = '{\n';
        for (const [subname, item] of tree.entries()) {
            if (item instanceof Map) {
                const generatedSub = await rec(item, indent + '    ');
                generated += indent + `    ${lowerCamelize(subname)}: ${generatedSub},\n`;
            } else {
                const stats = await fs.stat(item);
                const name = basename(subname);

                generated += indent + `    ${lowerCamelize(name)}: createItem(expand(
                    ${importName(assetDir, item)},
                    ${stats.size},
                )),\n`;
            }
        }
        generated += indent + '}';
        return generated;
    }

    let generated = '';
    generated += 'export function createFileCatalog<T>(createItem: (opts: CreateItemOptions) => T): FileCatalog<T> {\n';
    generated += `    return ${await rec(tree, '   ')};\n`;
    generated += '}\n';
    return generated;
}

function generateExpandFunction() {
    let generated = '';
    generated += 'function expand(path: string, size: number): CreateItemOptions {\n';
    generated += `    return { path, size };\n`;
    generated += '}\n';
    return generated;
}

function generateResolveFunction() {
    let generated = '';
    generated += 'export function resolveFromCatalog<T>(catalog: FileCatalog<T>, path: string[]): T {\n';
    generated += '    let current: any = catalog;\n';
    generated += `    for (const component of path) {\n`;
    generated += `        if (!(component in current)) throw new Error('Unresolvable catalog path: ' + path.join('.'));\n`;
    generated += `        current = current[component];\n`;
    generated += `    }\n`;
    generated += `    return current as T;\n`;
    generated += '}\n';
    return generated;
}

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .options({
            'outFile': {
                type: 'string',
                default: 'files.ts',
                alias: 'o',
                describe: 'Directory to generate the files into',
            },
            'dir': {
                type: 'string',
                default: '.',
                alias: 'd',
                describe: 'Asset directory where all the PNGs are located',
            },
        })
        .argv;

    const filesRoot = argv.dir;
    const generatedTs = argv.outFile;
    try {
        await fs.rm(generatedTs, {'recursive': true});
    } catch (e) {
    }

    const files = await allFiles(filesRoot);

    const imports = [];
    const tree = await generateTree(argv.dir, files);

    for (const file of files) {
        const importPath = relative(dirname(argv.outFile), file).replace(/\\/g, '/');
        imports.push(`import ${importName(argv.dir, file)} from './${importPath}';`);
    }

    let generatedFileContent = '';
    generatedFileContent += imports.join('\n');
    generatedFileContent += '\n\n';
    generatedFileContent += `export interface CreateItemOptions {
        path: string;
        size: number;
    }\n\n`;
    generatedFileContent += 'export type FileCatalog<T> = ' + generatedTemplateInterface(tree);
    generatedFileContent += '\n';
    generatedFileContent += generateExpandFunction();
    generatedFileContent += '\n';
    generatedFileContent += generateResolveFunction();
    generatedFileContent += '\n';
    generatedFileContent += await generatedCreateCatalogFunction(argv.dir, tree);

    await fs.writeFile(generatedTs, generatedFileContent);
}

main();
