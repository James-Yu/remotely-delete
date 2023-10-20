import { Notice, Plugin, Platform, FileSystemAdapter } from 'obsidian'
import * as electron from 'electron'
import * as glob from 'glob'
import * as path from 'path'
import * as fs from 'fs'

declare module 'obsidian' {
	interface App {
		commands: {
			commands: {
				[id: string]: Command
			}
			executeCommandById: (id: string) => void
		}
        plugins?: {
            plugins?: {
				[id: string]: Plugin
            }
        }
	}
}

interface RemotelySave extends Plugin {
    db: {
        fileHistoryTbl: {
            setItem(key: string, value: {[key:string]: string | number }): Promise<void>
        }
    }
    vaultRandomID: string
}

export default class RemotelyDeletePlugin extends Plugin {
    async addEntry(remotely: RemotelySave, file: string, fileStat: fs.Stats) {
        const isDirectory = fileStat.isDirectory()
        const entry = {
            key: file,
            ctime: isDirectory ? 0 : fileStat.ctime.getTime(),
            mtime: isDirectory ? 0 : fileStat.mtime.getTime(),
            size: isDirectory ? 0 : fileStat.size,
            actionWhen: Date.now(),
            actionType: 'delete',
            keyType: isDirectory ? 'folder' : 'file',
            renameTo: '',
            vaultRandomID: remotely.vaultRandomID,
        }
        console.log(entry)
        await remotely.db.fileHistoryTbl.setItem(`${remotely.vaultRandomID}\t${entry.key}`, entry)
    }

    get defaultPath() {
        const p = this.vaultPath + '/.obsidian'
        if (this.isWin) {
            return p.replace(/\//g, '\\')
        }
        return p
    }

    async deleteFile(filePathAbsolute: string) {
        const remotely = this.app.plugins?.plugins?.['remotely-save']
        if (remotely === undefined) {
            return
        }

        const fileStat = fs.existsSync(filePathAbsolute) && fs.statSync(filePathAbsolute)
        if (!fileStat) {
            return
        }

        await this.addEntry(remotely as RemotelySave, filePathAbsolute.replace(this.vaultPath + path.sep, '').replace(/\\/g, '/'), fileStat)
        fs.rmSync(filePathAbsolute, {recursive: true, force: true})
    }

    get dialog() {
        if (Platform.isMobile || Platform.isMobileApp) {
            return undefined
        }
        return 'remote' in electron ? (electron as unknown as {remote: {dialog: Electron.Dialog}}).remote.dialog : electron.dialog
    }

    getFiles(directory: string, fileList: string[] = []) {
        fs.readdirSync(directory).forEach(file => {
            const subFile = path.resolve(directory, file)
            if (fs.statSync(subFile).isDirectory()) {
                fileList = [...fileList, ...this.getFiles(subFile, fileList), subFile + '/']
            } else {
                fileList.push(subFile)
            }
        })

        return fileList
    }

    get isWin() {
        return process.platform === 'win32'
    }

    get isMac() {
        return process.platform === 'darwin'
    }

    get vaultPath() {
        return (this.app.vault.adapter as FileSystemAdapter).getBasePath()
    }

    async onload() {
        this.addCommand({
            id: 'delete-DSStore-in-vault',
            name: 'Delete .DS_Store files in vault',
            callback: async() => {
                const files = glob.globSync(path.resolve(this.vaultPath, '**/.DS_Store'), { dot: true })
                if (files.length === 0) {
                    new Notice('No .DS_Store files found in vault.')
                    return
                }
                for (const filePath of files) {
                    await this.deleteFile(filePath)
                }
                new Notice(`${files.length} .DS_Store file${files.length > 1 ? 's' : ''} deleted in vault.`)
                this.app.commands.executeCommandById('remotely-save:start-sync')
            },
        })

        if (!this.isMac) {
            this.addCommand({
                id: 'delete-files-in-obsidian-config',
                name: 'Delete files in .obsidian folder',
                callback: async () => {
                    const files = this.dialog?.showOpenDialogSync({
                        defaultPath: this.defaultPath,
                        properties: ['openFile', 'multiSelections']
                    })
                    if (files === undefined) {
                        return
                    }

                    for (const filePath of files) {
                        await this.deleteFile(filePath)
                        new Notice(`File ${filePath.replace(this.vaultPath + '/', '')} deleted.`)
                    }
                    this.app.commands.executeCommandById('remotely-save:start-sync')
                }
            })
        }

        this.addCommand({
            id: this.isMac ? 'delete-in-obsidian-config' : 'delete-folders-in-obsidian-config',
            name: this.isMac ? 'Delete folders or files in .obsidian folder' : 'Delete folders in .obsidian folder',
            callback: async () => {
				const files = this.dialog?.showOpenDialogSync({
					defaultPath: this.defaultPath,
					properties: ['openDirectory', 'openFile', 'multiSelections']
				})
				if (files === undefined) {
					return
				}

                for (let filePath of files) {
					const fileStat = fs.existsSync(filePath) && fs.statSync(filePath)
					if (!fileStat) {
						return
                    }
                    if (fileStat.isDirectory()) {
                        if (!filePath.endsWith('/')) {
                            filePath += '/'
                        }
                        for (const subFile of this.getFiles(filePath)) {
                            await this.deleteFile(subFile)
                            new Notice(`File ${subFile.replace(this.vaultPath + '/', '')} deleted.`)
                        }
                    }
                    await this.deleteFile(filePath)
                    new Notice(`File ${filePath.replace(this.vaultPath + '/', '')} deleted.`)
                }
                this.app.commands.executeCommandById('remotely-save:start-sync')
			}
		})
    }
}
