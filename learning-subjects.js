export const LEARNING_SUBJECTS=['日常表达','网络梗','音乐','绘画','游戏','工具与操作','其他知识'];
export function learningSubject(candidate,kind,text=''){
 if(LEARNING_SUBJECTS.includes(candidate))return candidate;
 if(kind==='meme')return '网络梗';if(['social','expression'].includes(kind))return '日常表达';
 if(/波形|频谱|节奏|音频|旋律|歌曲|音乐|歌词|拍速/.test(text))return '音乐';
 if(/画布|笔画|绘画|绘图|配色|构图|线稿|画笔/.test(text))return '绘画';
 if(/游戏|关卡|玩法|战斗|对局|通关/.test(text))return '游戏';
 if(/浏览器|登录|工具|文件|命令|软件|操作系统/.test(text))return '工具与操作';return '其他知识';
}
