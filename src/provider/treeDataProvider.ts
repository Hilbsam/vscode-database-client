import { CatalogNode } from "@/model/database/catalogNode";
import { EsConnectionNode } from "@/model/es/model/esConnectionNode";
import { InfoNode } from "@/model/other/infoNode";
import { RedisConnectionNode } from "@/model/redis/redisConnectionNode";
import { SSHConnectionNode } from "@/model/ssh/sshConnectionNode";
import * as vscode from "vscode";
import { CacheKey, DatabaseType } from "../common/constants";
import { ConnectionNode } from "../model/database/connectionNode";
import { SchemaNode } from "../model/database/schemaNode";
import { UserGroup } from "../model/database/userGroup";
import { CommandKey, Node } from "../model/interface/node";
import { DatabaseCache } from "../service/common/databaseCache";
import { ConnectionManager } from "../service/connectionManager";

export class DbTreeDataProvider implements vscode.TreeDataProvider<Node> {

    public _onDidChangeTreeData: vscode.EventEmitter<Node> = new vscode.EventEmitter<Node>();
    public readonly onDidChangeTreeData: vscode.Event<Node> = this._onDidChangeTreeData.event;
    public static instances: DbTreeDataProvider[] = []

    constructor(protected context: vscode.ExtensionContext, public readonly connectionKey: string) {
        DbTreeDataProvider.instances.push(this)
    }

    public getTreeItem(element: Node): Promise<vscode.TreeItem> | vscode.TreeItem {
        return element;
    }

    public async getChildren(element?: Node): Promise<Node[]> {
        if (!element) {
            return this.getConnectionNodes();
        }
        try {
            const children = await element.getChildren();
            for (const child of children) {
                child.parent = element;
            }
            return children;
        } catch (error) {
            return [new InfoNode(error)]
        }
    }

    public async openConnection(connectionNode: ConnectionNode) {
        connectionNode.disable = false;
        connectionNode.indent({ command: CommandKey.update })
    }

    public async disableConnection(connectionNode: ConnectionNode) {
        connectionNode.disable = true;
        connectionNode.indent({ command: CommandKey.update })
    }

    public async addConnection(node: Node) {

        node.initKey();
        if ((node as any).isGlobal != null) {
            node.context = (node as any).isGlobal === false ? this.context.workspaceState : this.context.globalState
            await node.indent({ command: CommandKey.delete, cacheKey: this.connectionKey })
        }

        node.context = node.global === false ? this.context.workspaceState : this.context.globalState
        node.indent({ command: CommandKey.add, cacheKey: this.getKeyByNode(node) })

    }

    private getKeyByNode(connectionNode: Node): string {
        const dbType = connectionNode.dbType;
        if (dbType == DatabaseType.ES || dbType == DatabaseType.REDIS || dbType==DatabaseType.SSH) {
            return CacheKey.NOSQL_CONNECTION;
        }
        return CacheKey.ConectionsKey;
    }


    public reload(element?: Node) {
        this._onDidChangeTreeData.fire(element);
    }

    /**
     * refresh treeview context
     */
    public static refresh(element?: Node): void {
        for (const instance of this.instances) {
            instance._onDidChangeTreeData.fire(element);
        }
    }

    public static getInstnace() {
        return this.instances;
    }

    public async getConnectionNodes(): Promise<Node[]> {

        let globalConnections = this.context.globalState.get<{ [key: string]: Node }>(this.connectionKey, {});
        let workspaceConnections = this.context.workspaceState.get<{ [key: string]: Node }>(this.connectionKey, {});

        const connections = { ...globalConnections, ...workspaceConnections };

        return Object.keys(connections).map(key => {
            const connectInfo = connections[key];
            return this.getNode(connectInfo, key);
        })

    }

    private getNode(connectInfo: Node, key: string) {
        let node: Node;
        if (connectInfo.dbType == DatabaseType.ES) {
            node = new EsConnectionNode(key, connectInfo);
        } else if (connectInfo.dbType == DatabaseType.REDIS) {
            node = new RedisConnectionNode(key, connectInfo)
        } else if (connectInfo.dbType == DatabaseType.SSH) {
            node = new SSHConnectionNode(key,connectInfo.ssh,connectInfo.name)
        } else {
            node = new ConnectionNode(key, connectInfo)
        }
        node.provider = this
        // Compatible with older versions
        if (node.global !== false) {
            node.global = true;
        }
        node.context = node.global === false ? this.context.workspaceState : this.context.globalState;
        return node;
    }

    public async activeDb() {

        const node = ConnectionManager.getByActiveFile()
        if (node) {
            vscode.window.showErrorMessage("Query file can not change active database.")
            return;
        }

        const dbIdList: string[] = [];
        const dbIdMap = new Map<string, SchemaNode>();
        const numbers = (await this.getConnectionNodes()).length > 1
        for (const dbNode of DatabaseCache.getDatabaseNodeList()) {
            if (dbNode instanceof UserGroup || dbNode instanceof CatalogNode) { continue }
            const uid = numbers ? dbNode.uid : dbNode.schema
            dbIdList.push(uid)
            dbIdMap.set(uid, dbNode)
        }
        if (dbIdList) {
            vscode.window.showQuickPick(dbIdList).then(async (dbId) => {
                if (dbId) {
                    const dbNode = dbIdMap.get(dbId);
                    ConnectionManager.changeActive(dbNode)
                    vscode.window.showInformationMessage(`Change active schema to ${dbNode.schema} success!`)
                }

            })
        }

    }

}
