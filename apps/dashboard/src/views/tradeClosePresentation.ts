export type ClosePresentation={label:string;cls:string;hint:string};
export function tradeClosePresentation(row:any):ClosePresentation{
  if(!row?.closedAt)return row?.observedClosedAt?{label:'零仓待对账',cls:'warn',hint:'本地已观察零仓，未证明完整结算账本；观察时间不是平仓成交时间'}:{label:'账本未闭合',cls:'neutral',hint:'未证明完整结算；此记录不能用来判断当前是否仍有物理持仓'};
  const kinds:Record<string,ClosePresentation>={
    TP:{label:'止盈平仓',cls:'good',hint:'订单 provenance registry 确认为系统 TP'},
    SYSTEM_EXIT:{label:'系统主动平仓',cls:'warn',hint:'订单 provenance registry 确认为系统 Exit'},
    SYSTEM_MANUAL:{label:'系统人工操作',cls:'warn',hint:'订单 provenance registry 确认为 Dashboard 手工操作'},
    EXCHANGE_CLOSE:{label:'交易所平仓',cls:'warn',hint:'平仓成交为交易所侧外部事实，且无系统订单 provenance'},
    MIXED_TP_MANUAL:{label:'止盈＋人工平仓',cls:'warn',hint:'不同 exact identity 分别为 TP 和人工退出；不是身份冲突'},
    MIXED:{label:'混合平仓',cls:'warn',hint:'周期包含多种已证明退出角色；不代表同一身份冲突'},
    MANUAL:{label:'系统人工操作',cls:'warn',hint:'exact durable manual identity'},
    CONFLICT:{label:'来源冲突',cls:'danger',hint:'平仓身份出现多个冲突 provenance'},
    UNKNOWN:{label:'未知来源',cls:'danger',hint:'没有足够订单 provenance，未根据 taker 标志推断来源'},
  };
  return kinds[String(row.closeProvenance??'UNKNOWN')]??kinds.UNKNOWN!;
}
