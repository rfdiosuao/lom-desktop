/** Only transitions between successful snapshots; first load/account changes are silent. */
export class DeviceTransitions {
  private account: string | undefined;
  private states=new Map<string,boolean>();
  observe(account:string|undefined, devices:{id:string;name:string;online:boolean}[], enabled:boolean):string[] {
    const changed=this.account!==account;
    const messages=account&&!changed&&enabled ? devices.filter(d=>this.states.has(d.id)&&this.states.get(d.id)!==d.online).map(d=>`${d.name}${d.online?'已上线':'已断开连接'}`) : [];
    this.account=account; this.states=new Map(account?devices.map(d=>[d.id,d.online]):[]);
    return messages;
  }
}
