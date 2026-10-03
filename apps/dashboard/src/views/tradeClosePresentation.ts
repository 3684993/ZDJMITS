export type ClosePresentation={label:string;cls:string;hint:string};
export function tradeClosePresentation(row:any):ClosePresentation{
  if(!row?.closedAt)return{label:'持仓中',cls:'neutral',hint:'尚未出现平仓成交时间'};
  const kinds:Record<string,ClosePresentation>={
    TP:{label:'止盈平仓',cls:'good',hint:'订单 provenance registry 确认为系统 TP'},
    SYSTEM_EXIT:{label:'系统主动平仓',cls:'warn',hint:'订单 provenance registry 确认为系统 Exit'},
    SYSTEM_MANUAL:{label:'系统人工操作',cls:'warn',hint:'订单 provenance registry 确认为 Dashboard 手工操作'},
    EXCHANGE_CLOSE:{label:'交易所平仓',cls:'warn',hint:'平仓成交为交易所侧外部事实，且无系统订单 provenance'},
    MIXED:{label:'多种已证实来源',cls:'warn',hint:'完整平仓成交分别归属不同已证实来源；不等同身份冲突'},
    CONFLICT:{label:'来源冲突',cls:'danger',hint:'平仓身份出现多个冲突 provenance'},
    UNKNOWN:{label:'未知来源',cls:'danger',hint:'没有足够订单 provenance，未根据 taker 标志推断来源'},
  };
  return kinds[String(row.closeProvenance??'UNKNOWN')]??kinds.UNKNOWN!;
}
