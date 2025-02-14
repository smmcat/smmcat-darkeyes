import { Context, Schema, h } from 'koishi'
import { } from 'koishi-plugin-smmcat-localstorage'
import path from 'path'
import fs from 'fs/promises'
export const name = 'smmcat-darkeyes'

export interface Config {
  autoClearPlay: number
  deBug: boolean
  verifyPass: string[]
  verifyName: string[]
  customPlayName: boolean
}
export const inject = ['localstorage']

export const Config: Schema<Config> = Schema.object({
  autoClearPlay: Schema.number().default(12e4).description("指定等待时间未进行自动结束游戏"),
  customPlayName: Schema.boolean().default(false).description("由玩家自己创建游戏名字"),
  verifyPass: Schema.array(String).role("table").default([
    "涩图",
    "约炮",
    "雌小鬼",
    "男娘"
  ]).description("过滤战局对话中的不良内容词汇"),
  verifyName: Schema.array(String).role("table").default([
    "傻逼",
    "约炮",
    "雌小鬼",
    "男娘"
  ]).description("过滤不良昵称（需要开启 verifyPass 选项）"),
  deBug: Schema.boolean().default(false).description("日志查看更多信息")
})

export function apply(ctx: Context, config: Config) {

  enum Duty {
    /** 平民 */
    civilian = 1,
    /** 强盗 */
    bandit = 2,
    /** 探员 */
    detective = 3,
    /** 医生 */
    medic = 4,
    /** 狙击手 */
    sniper = 5,
    /** 间谍 */
    spy = 6,
    /** 特工 */
    secretService = 7
  }

  enum Lineup {
    up = '正义单位',
    down = '邪恶组织'
  }

  const infoRule = {
    up: [1, 3, 4, 7], // 正义单位
    down: [2, 5, 6], // 邪恶单位
    dict: { 1: '平民', 2: '强盗', 3: '探员', 4: '医生', 5: '狙击手', 6: '间谍', 7: '特工' },
    info: {
      1: `所属【${Lineup.up}】\n白天协助探员一起抓强盗，当炮灰是光荣的！`,
      2: `所属【${Lineup.down}】\n潜伏在人群中煽动群员投票，晚上伺机而动选择目标`,
      3: `所属【${Lineup.up}】\n晚上调查身份，白天引导群员抓坏蛋。注意尽量不要主动被强盗盯上`,
      4: `所属【${Lineup.up}】\n医生的针可以抵挡一次晚上强盗的攻击，但第二次对ta使用就是毒药了`,
      5: `所属【${Lineup.down}】\n你的狙击枪可以在晚上一枪毙命选中的目标，子弹有限，注意选择高价值单位`,
    }
  }


  const darkEyes = {
    playGuild: {},
    // 群对象
    characters: [],
    // 虚拟身份
    customCharacters: {},
    // 用户自定义昵称
    playingUser: {},
    // 正在进行游戏的玩家
    async init() {
      if (config.customPlayName && ctx.localstorage) {
        const baseDir = path.join(ctx.localstorage.basePath, "smmcat-darkeyes/userPlayname");
        try {
          await fs.access(path.join(baseDir));
        } catch (error) {
          await fs.mkdir(baseDir, { recursive: true });
        }
        const playNameDir = await fs.readdir(baseDir);
        const dict = { ok: 0, err: 0 };
        const temp = {};
        const eventList = playNameDir.map((item) => {
          return new Promise(async (resolve, reject) => {
            try {
              temp[item] = JSON.parse(await ctx.localstorage.getItem(`smmcat-darkeyes/userPlayname/${item}`));
              dict.ok++;
              resolve(true);
            } catch (error) {
              console.log(error);
              dict.err++;
              resolve(true);
            }
          });
        });
        await Promise.all(eventList);
        this.customCharacters = temp;
        console.log(`[smmcat-darkeyes]: 初始化用户自定义名称成功，成功${dict.ok}个，失败${dict.err}个`);
      }
      try {
        const res = await ctx.http.get("https://smmcat.cn/run/baraffle/all.json");
        this.characters = res.data.map((item) => {
          return {
            name: item.name,
            pic: item.path
          };
        });
      } catch (error) {
        console.log(error);
      }
    },
    // 获得玩家名字
    async getPlayName(session) {
      if (config.customPlayName && ctx.localstorage) {
        if (!this.customCharacters[session.userId]) {
          await session.send("检测到您未设置天黑请闭眼的游戏昵称，\n请接下来20秒内告诉我您想起什么游戏使用名字？以便我今后将使用该昵称称呼您~");
          const res = await session.prompt(2e4);
          if (res === void 0) {
            await session.send("设置自定义游戏昵称失败，原因：超时\n将为您采用随机角色");
            return this.playGuild[session.guildId].characters.pop();
          }
          const secureRes = this.verifyName(res);
          if (!secureRes.code) {
            await session.send(`设置自定义游戏昵称失败，原因：${secureRes.msg}
将为您采用随机角色`);
            return this.playGuild[session.guildId].characters.pop();
          }
          this.customCharacters[session.userId] = {
            name: secureRes.name,
            pic: ""
          };
          this.updateUserNameStore(session.userId);
        }
        return this.customCharacters[session.userId];
      } else {
        return this.playGuild[session.guildId].characters.pop();
      }
    },
    // 本地更新玩家游戏昵称
    async updateUserNameStore(userId) {
      const goal = this.customCharacters[userId];
      await ctx.localstorage.setItem(`smmcat-darkeyes/userPlayname/${userId}`, JSON.stringify(goal));
    },
    // 验证玩家游戏名称
    verifyName(userName) {
      userName = userName.replace(/[\s\n\p{P}]/gu, "");
      if (!userName)
        return { code: false, name: null, msg: "名字不能为空" };
      const isRepeat = Object.values(this.customCharacters).map((item: { name: string, pic: string }) => item.name).includes(userName);
      if (isRepeat)
        return { code: false, name: null, msg: "与其他玩家名字重复，或者您并没有修改原名" };
      if (userName.length > 8)
        return { code: false, name: null, msg: "玩家名字过长（需小于8字符）" };
      const isBadness = config.verifyName.some((item) => {
        if (userName.includes(item)) {
          return true;
        }
        return false;
      });
      if (isBadness)
        return { code: false, name: null, msg: "设置的昵称存在违禁词" };
      return { code: true, name: userName };
    },
    // 过滤玩家发言
    filterMsgPass(msg) {
      msg = msg.replace(/\s/g, "");
      config.verifyPass.forEach((item) => {
        if (msg.includes(item)) {
          let regex = new RegExp(msg, "g");
          msg = msg.replace(regex, "*");
        }
      });
      return msg;
    },
    // 玩家修改游戏昵称
    async changePlayName(session, userName) {
      if (userName === void 0) {
        await session.send("请告诉我您下次游玩天黑请闭眼游戏默认采用的昵称（20秒内）");
        const _userName = await session.prompt(2e4);
        if (_userName === void 0)
          return { code: false, msg: "长时间未操作，设置失败" };
        const secureRes = this.verifyName(_userName);
        if (!secureRes.code)
          return { code: false, msg: `设置自定义游戏昵称失败，原因：${secureRes.msg}` };
        this.customCharacters[session.userId] = {
          name: secureRes.name,
          pic: ""
        };
        this.updateUserNameStore(session.userId);
        return { code: true, msg: `设置成功，您的新游戏昵称为：${secureRes.name}` };
      } else {
        const secureRes = this.verifyName(userName);
        if (!secureRes.code)
          return { code: false, msg: `设置自定义游戏昵称失败，原因：${secureRes.msg}` };
        this.customCharacters[session.userId] = {
          name: secureRes.name,
          pic: ""
        };
        this.updateUserNameStore(session.userId);
        return { code: true, msg: `设置成功，您的新游戏昵称为：${secureRes.name}` };
      }
    },
    // 准备阶段
    async readyPlay(session) {
      if (!session.guildId)
        return { code: false, msg: "请在群内准备游戏！" };
      if (this.playGuild[session.guildId])
        return { code: false, msg: "该群已经正在进行游戏，不能重复开启" };
      this.playGuild[session.guildId] = {
        session,
        light: true,
        //是否白天
        procedure: 0,
        // 回合
        ready: true,
        // 准备阶段
        isPlay: false,
        // 开始阶段
        stopCheck: false,
        // 是否禁止再查
        playUser: {},
        // 所有玩家
        boutTime: null,
        // 执行周期循环事件
        countdown: null,
        nowTemp: [],
        // 缓存数据 存活人员
        characters: tool.getFreeList(this.characters),
        closeTime: ctx.setTimeout(async () => {
          darkEyes.clearPlay(session, true);
          await session.send("长时间未开始游戏，已自动结束进行");
        }, config.autoClearPlay)
      };
      const res = await this.addPlay(session);
      config.deBug && console.log(this.playGuild);
      return { code: true, msg: `创建成功，已自动为你加入，你将扮演 ${res.name}。其他人请发送 /加入游戏` };
    },
    // 加入游戏
    async addPlay(session) {
      if (!session.guildId)
        return { code: false, msg: "请在群内加入游戏！" };
      if (!this.playGuild[session.guildId])
        return { code: false, msg: "当前群内还未开始游戏" };
      if (this.playingUser[session.userId])
        return { code: false, msg: "您正在正在进行游戏，不能重复加入" };
      if (this.playGuild[session.guildId]?.isPlay)
        return { code: false, msg: "游戏已在进行，不能中途加入" };
      if (Object.keys(this.playGuild[session.guildId].playUser).length == 15)
        return { code: false, msg: "游戏人数已满，最多16人" };
      this.playingUser[session.userId] = session.guildId;
      const characters = await this.getPlayName(session);
      const th_id = Object.keys(this.playGuild[session.guildId].playUser).length + 1;
      this.playGuild[session.guildId].playUser[session.userId] = Object.assign(
        { session: { userId: session.userId, send: (a) => null } },
        {
          th_id,
          duty: Duty.civilian,
          // 身份
          characters,
          // 虚拟角色信息
          isDie: false,
          // 是否死亡
          referendum: false,
          // 是否投票
          isCheck: false,
          // 是否被调查
          lastWords: "",
          // 遗言
          isVote: false,
          // 是否投票
          beVoted: 0,
          // 被投票数
          killBeVoted: 0,
          // 杀手投票数
          checkBevoted: 0,
          // 探员投票数
          hitCount: 1,
          // 狙杀次数
          healCount: 1,
          // 治疗次数
          sethealCount: 0,
          // 被治疗次数
          isHeal: false,
          // 本回合是否是否被治疗
          isSetHeal: false,
          // 本回合是否使用针指令
          isSetHit: false,
          // 本回合是否使用狙指令
          isLastWords: false
          // 是否发表过遗言
        }
      );
      config.deBug && console.log(`${characters.name}---->${infoRule.dict[this.playGuild[session.guildId].playUser[session.userId].duty]}`);
      return { code: true, msg: `加入成功，你现在将扮演 ${characters.name} 进行游戏！`, name: characters.name };
    },
    // 结束游戏
    clearPlay(session, auto = false) {
      const res = this.verifyIsPlay(session);
      if (!res.code)
        return res;
      this.playGuild[session.guildId].closeTime && this.playGuild[session.guildId].closeTime();
      this.playGuild[session.guildId].countDown && this.playGuild[session.guildId].countDown();
      const playUserList = Object.keys(this.playGuild[session.guildId].playUser);
      playUserList.forEach((item) => {
        delete darkEyes.playingUser[item];
      });
      delete this.playGuild[session.guildId];
      config.deBug && console.log(darkEyes.playGuild);
      config.deBug && console.log(darkEyes.playingUser);
      if (!auto)
        return { code: false, msg: "天黑请闭眼游戏已主动结束" };
    },
    // 开始游戏
    async startPlay(session) {
      const isPlay = this.verifyIsPlay(session);
      if (!isPlay.code) {
        await session.send(isPlay.msg);
        return;
      }
      const res = this.checkPlay(session);
      if (!res.code)
        return res.msg;
      await session.send(res.msg);
      await session.send("游戏已经开始了！请参与游玩的群员私聊我 /身份 获取自己的身份。\ntis:只有私聊发送身份的玩家，才可以接收后续消息。请不要告知其他人自己身份");
      this.playGuild[session.guildId].isPlay = true;
      this.playGuild[session.guildId].closeTime && this.playGuild[session.guildId].closeTime();
      let result = "";
      while (true) {
        this.playGuild[session.guildId].procedure++;
        this.playGuild[session.guildId].light = true;
        const res2 = this.battleReport(session);
        await session.send(res2.msg);
        const data1 = this.settleTheScore(session);
        if (data1.code) {
          session.send(data1.msg);
          result = darkEyes.overInfoMsg(session);
          break;
        }
        this.playGuild[session.guildId].session.send(this.playGuild[session.guildId].procedure == 1 ? "第一天的白天，大家可以简单都认识认识，或者直接参与 /投票 下标 进行投票。" : "白天所有人均可以选择 /投票 下标 进行投票。");
        await this.countDown(session, 120);
        await this.settlementReferendum(session);
        this.clerReferendum(session);
        this.playGuild[session.guildId].light = false;
        const res22 = this.battleReport(session);
        await session.send(res22.msg);
        const data2 = this.settleTheScore(session);
        if (data2.code) {
          session.send(data2.msg);
          result = darkEyes.overInfoMsg(session);
          break;
        }
        this.playGuild[session.guildId].session.send("黑夜了，平民睡着了，而两大势力在窃机行动...");
        this.autoBattleReport(session);
        await this.countDown(session, 60, "天亮");
        await this.settlementCutTime(session);
        this.clerReferendum(session);
      }
      darkEyes.clearPlay(session, true);
      return result;
    },
    // 发起倒计时
    countDown(session, needTime = 60, msg = "天黑") {
      return new Promise((resolve, reject) => {
        this.playGuild[session.guildId].countDown = ctx.setInterval(async () => {
          needTime--;
          config.deBug && console.log(needTime);
          if (needTime == 20 && msg == "天亮") {
            darkEyes.playGuild[session.guildId].stopCheck = true;
            await session.send(`探员们行动中...`);
            await darkEyes.settlementCheckTime(session);
          }
          if (needTime == 10) {
            session.send(`离${msg}剩余 10 秒！`);
          } else if (needTime == 0) {
            this.playGuild[session.guildId].countDown();
            resolve(true);
          }
        }, 1e3);
      });
    },
    checkPlay(session) {
      const guild = this.playGuild[session.guildId];
      const userIdList = Object.keys(guild.playUser);
      if (userIdList.length < 4) {
        return { code: false, msg: "参与游玩的人数小于4人，创建失败" };
      }
      const msg = this.initPlayGame(session, userIdList);
      return { code: true, msg: "分配身份完成，" + msg };
    },
    // 匹配人员
    initPlayGame(session, userIdList) {
      const guild = this.playGuild[session.guildId];
      const humanDict = {
        4: { 1: 2, 2: 1, 3: 1 },
        5: { 1: 3, 2: 1, 3: 1 },
        6: { 1: 4, 2: 1, 3: 1 },
        // 4平 1探 1强
        7: { 1: 5, 2: 1, 3: 1 },
        // 5平 1探 1强
        8: { 1: 4, 2: 2, 3: 2 },
        // 4平 2探 2强
        9: { 1: 5, 2: 2, 3: 2 },
        // 5平 2探 2强
        10: { 1: 6, 2: 2, 3: 2 },
        // 6平 2探 2强
        11: { 1: 5, 2: 2, 3: 2, 4: 1, 5: 1 },
        // 5平 2探 2强 1医 1狙
        12: { 1: 6, 2: 2, 3: 2, 4: 1, 5: 1 },
        // 6平 2探 2强 1医 1狙
        13: { 1: 5, 2: 3, 3: 3, 4: 1, 5: 1 },
        // 5平 3探 3强 1医 1狙
        14: { 1: 6, 2: 3, 3: 3, 4: 1, 5: 1 },
        // 6平 3探 3强 1医 1狙
        15: { 1: 5, 2: 4, 3: 4, 4: 1, 5: 1 }
        // 5平 4探 4强 1医 1狙
      };
      let dictMap = [];
      const selectMap = humanDict[userIdList.length];
      const selsectKey = Object.keys(selectMap);
      selsectKey.forEach((item) => {
        for (let i = 0; i < selectMap[item]; i++) {
          dictMap.push(item);
        }
      });
      dictMap = tool.getFreeList(dictMap);
      userIdList.forEach((item, index) => {
        guild.playUser[item].duty = Number(dictMap[index]);
        if (guild.playUser[item].duty === Duty.medic) {
          guild.playUser[item].healCount = selectMap[Duty.detective];
        } else if (guild.playUser[item].duty === Duty.sniper) {
          guild.playUser[item].healCount = selectMap[Duty.detective];
        }
      });
      return `当前玩家分配：
${selsectKey.map((item) => {
        return `「${infoRule.dict[item]}」 ${selectMap[item]}人`;
      }).join("\n")}`;
    },
    // 结算得分
    settleTheScore(session) {
      const guild = this.playGuild[session.guildId];
      const nowTemp = guild.nowTemp;
      config.deBug && console.log(nowTemp);
      const dict = {};
      nowTemp.forEach((item) => {
        if (!dict[item.duty]) {
          dict[item.duty] = { count: 1, human: [] };
        }
        dict[item.duty].count++;
        dict[item.duty].human.push(item.characters.name);
      });
      if (!dict[Duty.bandit]) {
        return { code: true, msg: `${infoRule.dict[Duty.bandit]}全被消灭，${Lineup.up} 胜利！` };
      } else if (!dict[Duty.detective]) {
        return { code: true, msg: `${infoRule.dict[Duty.detective]}全被消灭，${Lineup.down} 胜利！` };
      } else if (!dict[Duty.civilian]) {
        return { code: true, msg: `${infoRule.dict[Duty.civilian]}全被消灭，${Lineup.down} 胜利！` };
      } else if (guild.procedure == 10) {
        return { code: true, msg: `回合超时，${Lineup.up} 胜利！` };
      }
      return { code: false, msg: "" };
    },
    // 结算后的队伍信息展示
    overInfoMsg(session) {
      const guild = this.playGuild[session.guildId];
      const nowTemp = Object.keys(guild.playUser).map((item) => {
        return this.playGuild[session.guildId].playUser[item];
      });
      config.deBug && console.log(nowTemp);
      const dict = {};
      nowTemp.forEach((item) => {
        if (!dict[item.duty]) {
          dict[item.duty] = { count: 1, human: [] };
        }
        dict[item.duty].count++;
        dict[item.duty].human.push(item.characters.name);
      });
      const justice = [Duty.civilian, Duty.detective, Duty.medic];
      const evil = [Duty.bandit, Duty.sniper];
      const justiceList = `【${Lineup.up}阵容】
` + justice.map((item) => {
        if (dict[item]) {
          return `「${infoRule.dict[item]}」:` + dict[item].human.join("、");
        }
        return null;
      }).filter((item) => item).join("\n");
      const evilList = `【${Lineup.down}阵容】
` + evil.map((item) => {
        if (dict[item]) {
          return `「${infoRule.dict[item]}」:` + dict[item].human.join("、");
        }
        return null;
      }).filter((item) => item).join("\n");
      return `感谢扮演双方阵容的人员：

` + justiceList + `
-----------------------
` + evilList;
    },
    // 战况主动推送
    autoBattleReport(session) {
      const lifeTemp = this.playGuild[session.guildId].nowTemp;
      const setGoal = lifeTemp.filter((item) => item.duty !== Duty.civilian);
      setGoal.forEach((item) => {
        item.session.send(this.battleReport(item.session, item.duty).msg);
      });
    },
    // 战况播报
    battleReport(session, show = 0) {
      const guild = this.playingUser[session.userId];
      const procedure = this.playGuild[guild].procedure;
      const PlayKeys = Object.keys(this.playGuild[guild].playUser);
      const playList = this.playGuild[guild].playUser;
      const referendumList = [];
      const dieList = [];
      const lifeList = PlayKeys.filter((item) => {
        if (playList[item].referendum) {
          referendumList.push(playList[item]);
          return false;
        }
        return true;
      }).filter((item) => {
        if (playList[item].isDie) {
          dieList.push(playList[item]);
          return false;
        }
        return true;
      }).map((item) => {
        return playList[item];
      });
      this.playGuild[guild].nowTemp = lifeList;
      switch (show) {
        case 0:
          return this.battleReport_format(referendumList, dieList, lifeList, procedure, session);
        case Duty.bandit:
          return this.bandit_battleReport_format(referendumList, dieList, lifeList, procedure, session);
        case Duty.detective:
          return this.detective_battleReport_format(referendumList, dieList, lifeList, procedure, session);
        default:
          return this.battleReport_format(referendumList, dieList, lifeList, procedure, session);
      }
    },
    // 战况信息格式化
    battleReport_format(referendumList, dieList, lifeList, procedure, session) {
      const guild = this.playingUser[session.userId];
      const info = `目前情况：${referendumList.length ? `${referendumList.length}名被投票退出，` : ""} ${dieList.length ? `${dieList.length}名阵亡，` : ""}存活${lifeList.length}名`;
      const temp = {
        3: lifeList.filter((item) => item.duty === Duty.detective).length,
        2: lifeList.filter((item) => item.duty === Duty.bandit).length,
        1: lifeList.filter((item) => item.duty === Duty.civilian).length
      };
      const lineupInfo = `重要单位：` + Object.keys(temp).map((item) => {
        return `[${infoRule.dict[item]}] 剩余` + temp[item] + "名";
      }).join(" ");
      const msg = `第${procedure}回合 [${this.playGuild[guild].light ? "白天" : "黑夜"}环节]

` + info + `
---------存活---------
` + lifeList.map((item) => {
        return `${item.th_id}. ${item.characters.name}` + (item.beVoted ? ` [被投票数：${item.beVoted}]` : "");
      }).join("\n") + "\n-----------------------\n" + lineupInfo;
      return { msg, info: temp };
    },
    // 战况信息格式化 - 强盗用
    bandit_battleReport_format(referendumList, dieList, lifeList, procedure, session) {
      const guild = this.playingUser[session.userId];
      const info = `目前情况：${referendumList.length ? `${referendumList.length}名被投票退出，` : ""} ${dieList.length ? `${dieList.length}名阵亡，` : ""}存活${lifeList.length}名`;
      const temp = {
        3: lifeList.filter((item) => item.duty === Duty.detective).length,
        2: lifeList.filter((item) => item.duty === Duty.bandit).length,
        1: lifeList.filter((item) => item.duty === Duty.civilian).length
      };
      const lineupInfo = `重要单位：` + Object.keys(temp).map((item) => {
        return `[${infoRule.dict[item]}] 剩余` + temp[item] + "名";
      }).join(" ");
      const msg = `第${procedure}回合 [${this.playGuild[guild].light ? "白天" : "黑夜"}环节]

` + info + `
---------存活---------
` + lifeList.map((item) => {
        return `${item.th_id}. ${item.characters.name} ${item.duty === Duty.bandit ? `(${infoRule.dict[Duty.bandit]})` : ""}` + (item.killBeVoted ? ` [决策数：${item.killBeVoted}]` : "") + (item.session.userId === session.userId ? " | 你 |" : "");
      }).join("\n") + "\n-----------------------\n" + lineupInfo;
      return { msg, info: temp };
    },
    // 战况信息格式化 - 探员用
    detective_battleReport_format(referendumList, dieList, lifeList, procedure, session) {
      const guild = this.playingUser[session.userId];
      const info = `目前情况：${referendumList.length ? `${referendumList.length}名被投票退出，` : ""} ${dieList.length ? `${dieList.length}名阵亡，` : ""}存活${lifeList.length}名`;
      const temp = {
        3: lifeList.filter((item) => item.duty === Duty.detective).length,
        2: lifeList.filter((item) => item.duty === Duty.bandit).length,
        1: lifeList.filter((item) => item.duty === Duty.civilian).length
      };
      const lineupInfo = `重要单位：` + Object.keys(temp).map((item) => {
        return `[${infoRule.dict[item]}] 剩余` + temp[item] + "名";
      }).join(" ");
      const msg = `第${procedure}回合 [${this.playGuild[guild].light ? "白天" : "黑夜"}环节]

` + info + `
---------存活---------
` + lifeList.map((item) => {
        return `${item.th_id}. ${item.characters.name} ${item.isCheck || item.duty === Duty.detective ? `(${infoRule.dict[item.duty]})` : ""}` + (item.checkBevoted ? ` [决定数：${item.checkBevoted}]` : "") + (item.session.userId === session.userId ? " | 你 |" : "");
      }).join("\n") + "\n-----------------------\n" + lineupInfo;
      return { msg, info: temp };
    },
    // 群众投票单位
    setVote(session, th_id) {
      const res = this.verifyIsPlay(session);
      if (!res.code)
        return res;
      if (!this.playGuild[session.guildId].isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[session.guildId].playUser[session.userId].isDie)
        return { code: false, msg: darkEyes.isMe(session) + "你已阵亡，不能参与投票" };
      if (this.playGuild[session.guildId].playUser[session.userId].referendum)
        return { code: false, msg: darkEyes.isMe(session) + "你已被群众肃清，不能参与投票" };
      if (!this.playGuild[session.guildId].light)
        return { code: false, msg: darkEyes.isMe(session) + "只有白天才可以参与投票" };
      const goal = this.playGuild[session.guildId].nowTemp.find((item) => item.th_id === th_id);
      if (!goal)
        return { code: false, msg: `没有找到${darkEyes.isMe(session)}你要投票的下标单位` };
      if (session.userId === goal.session.userId)
        return { code: false, msg: darkEyes.isMe(session) + "不可以投票自己！" };
      if (this.playGuild[session.guildId].playUser[session.userId].isVote)
        return { code: false, msg: darkEyes.isMe(session) + "你已经投票过了" };
      this.playGuild[session.guildId].playUser[session.userId].isVote = true;
      goal.beVoted++;
      const youUser = this.playGuild[session.guildId].playUser[session.userId];
      return {
        code: true, msg: `${youUser.characters.name} 投票成功！
本轮${goal.characters.name}的被投票数增加。目前是${goal.beVoted}票`
      };
    },
    // 获取我的名字
    isMe(session) {
      const guild = this.playingUser[session.userId];
      return this.playGuild[guild].playUser[session.userId].characters.name;
    },
    // 强盗指令
    cutVote(session, th_id) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[guild].playUser[session.userId].duty !== Duty.bandit)
        return { code: false, msg: `只有${infoRule.dict[Duty.bandit]}才可以使用 /杀` };
      if (this.playGuild[guild].playUser[session.userId].isDie)
        return { code: false, msg: darkEyes.isMe(session) + "你已阵亡，不能再行动了" };
      if (this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: darkEyes.isMe(session) + "你已被群众肃清，不能再行动了" };
      if (this.playGuild[guild].light)
        return { code: false, msg: darkEyes.isMe(session) + "只有夜晚才可以参与突袭" };
      const goal = this.playGuild[guild].nowTemp.find((item) => item.th_id === th_id);
      if (!goal)
        return { code: false, msg: `没有找到 ${darkEyes.isMe(session)} 你要突袭的下标单位` };
      if (goal.isDie)
        return { code: false, msg: `${goal.characters.name} 刚刚已经阵亡。不用杀了` };
      if (session.userId === goal.session.userId)
        return { code: false, msg: darkEyes.isMe(session) + "不可以投票自己！" };
      if (this.playGuild[guild].playUser[session.userId].isVote)
        return { code: false, msg: darkEyes.isMe(session) + "你已经选择过了" };
      this.playGuild[guild].playUser[session.userId].isVote = true;
      goal.killBeVoted++;
      return { code: true, msg: darkEyes.isMe(session) + `选择成功！本轮决定鲨${goal.characters.name}的选择数增加。目前是${goal.killBeVoted}票` };
    },
    // 调查指令
    checkVote(session, th_id) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[guild].playUser[session.userId].duty !== Duty.detective)
        return { code: false, msg: `只有${infoRule.dict[Duty.detective]}才可以使用 /查` };
      if (this.playGuild[guild].playUser[session.userId].isDie)
        return { code: false, msg: darkEyes.isMe(session) + "你已阵亡，不能再查了" };
      if (this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: darkEyes.isMe(session) + "你已被群众肃清，不能再查了" };
      if (this.playGuild[guild].light)
        return { code: false, msg: "只有夜晚才可以参与查" };
      const goal = this.playGuild[guild].nowTemp.find((item) => item.th_id === th_id);
      if (!goal)
        return { code: false, msg: "没有找到你要查的下标单位" };
      if (goal.isDie)
        return { code: false, msg: `${goal.characters.name} 刚刚已经阵亡。不用调查了` };
      if (session.userId === goal.session.userId)
        return { code: false, msg: darkEyes.isMe(session) + " 不可以投票自己！" };
      if (this.playGuild[guild].playUser[session.userId].isVote)
        return { code: false, msg: darkEyes.isMe(session) + " 你已经选择过了" };
      if (this.playGuild[guild].stopCheck)
        return { code: false, msg: `允许查的时间过去了，「${infoRule.dict[Duty.detective]}们现在是撤退状态` };
      if (goal.duty === Duty.detective)
        return { code: false, msg: `ta 是与${darkEyes.isMe(session)}你的同伴，不需要检查！` };
      this.playGuild[guild].playUser[session.userId].isVote = true;
      goal.checkBevoted++;
      return { code: true, msg: `选择成功！本轮决定查${goal.characters.name}的选择数增加。目前是${goal.checkBevoted}票` };
    },
    // 狙杀指令
    hitVote(session, th_id) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[guild].playUser[session.userId].duty !== Duty.sniper)
        return { code: false, msg: `只有${infoRule.dict[Duty.sniper]}才可以使用 /狙` };
      if (this.playGuild[guild].playUser[session.userId].isDie || this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: "你已阵亡，不能再狙了" };
      if (this.playGuild[guild].light)
        return { code: false, msg: "只有夜晚才可以狙人" };
      if (this.playGuild[guild].playUser[session.userId].isSetHit)
        return { code: false, msg: "本夜你已经使用过狙指令！" };
      if (this.playGuild[guild].playUser[session.userId].hitCount == 0)
        return { code: false, msg: "你已经没有子弹了" };
      const goal = this.playGuild[guild].nowTemp.find((item) => item.th_id === th_id);
      if (!goal)
        return { code: false, msg: "没有找到你要狙的下标单位" };
      if (session.userId === goal.session.userId)
        return { code: false, msg: darkEyes.isMe(session) + "不可以狙自己！" };
      this.playGuild[guild].playUser[session.userId].hitCount--;
      this.playGuild[guild].playUser[session.userId].isSetHit = true;
      goal.isDie = true;
      goal.session.send(darkEyes.isMe(session) + "你已阵亡，您可以留下 /遗言 提供给群众有用的信息");
      this.playGuild[guild].session.send(`夜晚有一位路过的靓仔把身份是「${infoRule.dict[goal.duty]}」的 ${goal.characters.name} 一枪爆头...`);
      const msg = this.playGuild[guild].playUser[session.userId].hitCount ? `已命中，${darkEyes.isMe(session)}你消耗了一枚弹药，你还剩余弹药数：` + this.playGuild[guild].playUser[session.userId].hitCount : "已命中，你的弹药数已用完";
      return { code: true, msg };
    },
    // 医生指令
    healVote(session, th_id) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[guild].playUser[session.userId].duty !== Duty.medic)
        return { code: false, msg: `只有「${infoRule.dict[Duty.medic]}」才可以使用 /针` };
      if (this.playGuild[guild].playUser[session.userId].isDie || this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: darkEyes.isMe(session) + "你已阵亡，不能再针了" };
      if (this.playGuild[guild].light)
        return { code: false, msg: darkEyes.isMe(session) + " 只有夜晚才可以针人" };
      if (this.playGuild[guild].playUser[session.userId].healCount == 0)
        return { code: false, msg: darkEyes.isMe(session) + " 你已经没有针了" };
      const goal = this.playGuild[guild].nowTemp.find((item) => item.th_id === th_id);
      if (!goal)
        return { code: false, msg: darkEyes.isMe(session) + " 没有找到你要针的下标单位" };
      if (goal.isDie)
        return { code: false, msg: `${goal.characters.name} 刚刚已经阵亡。已经不用治疗了` };
      this.playGuild[guild].playUser[session.userId].healCount--;
      this.playGuild[guild].isSetHeal = true;
      goal.isHeal = true;
      goal.sethealCount++;
      if (goal.sethealCount == 2) {
        goal.isDie = true;
        goal.session.send(darkEyes.isMe(session) + "你已阵亡，您可以留下 /遗言 提供给群众有用的信息");
        this.playGuild[guild].session.send(`身份是「${infoRule.dict[goal.duty]}」的 ${goal.characters.name} 被 ${infoRule.dict[Duty.medic]} 针了两次，针死了...`);
      } else {
        this.playGuild[guild].session.send(`${infoRule.dict[Duty.medic]} 对 ${goal.characters.name} 使用了一次针`);
      }
      const msg = this.playGuild[guild].playUser[session.userId].hitCount ? "已使用，你消耗了一次针，你还剩余针数：" + this.playGuild[guild].playUser[session.userId].hitCount : "已使用，你的针已用完";
      return { code: true, msg };
    },
    // 发布遗言
    tallLastWords(session, msg) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      if (this.playGuild[guild].playUser[session.userId].isDie || this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: "你还未阵亡，无法发表遗言" };
      if (this.playGuild[guild].playUser[session.userId].isLastWords)
        return { code: false, msg: "你已发表过遗言，无法再次发表遗言" };
      const user = this.playGuild[guild].playUser[session.userId];
      user.isLastWords = true;
      msg = this.filterMsgPass(msg);
      const msgg = `[${user.characters.name}]「${infoRule.dict[user.duty]}」的遗言: ${msg}`;
      this.playGuild[guild].session.send(msgg);
      return { code: true, msg: "你的遗言发表完成" };
    },
    // 局内小队对话
    talkUser(session, msg) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      const mayUse = [2, 3];
      const duty = this.playGuild[guild].playUser[session.userId].duty;
      if (!mayUse.includes(duty))
        return { code: false, msg: "非阵容人员，无法使用 聊 功能" };
      if (this.playGuild[guild].playUser[session.userId].isDie || this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: "你已阵亡，不能再主动发言了" };
      if (this.playGuild[guild].playUser[session.userId].referendum)
        return { code: false, msg: "你已被群众肃清，不能再主动发言了" };
      if (this.playGuild[guild].light)
        return { code: false, msg: "只有夜晚才可以参与对话" };
      const banditList = Object.keys(this.playGuild[guild].playUser).map((item) => {
        return this.playGuild[guild].playUser[item];
      }).filter((item) => {
        if (item.session.userId !== session.userId && item.duty === duty)
          return true;
        return false;
      });
      msg = this.filterMsgPass(msg);
      banditList.forEach((item) => {
        item.session.send(`[${item.characters.name}]「${infoRule.dict[item.duty]}」说:` + msg);
      });
      return { code: true, msg: "" };
    },
    // 告知身份
    askStanding(session) {
      const res = this.verifyIsPrivatePlay(session);
      if (!res.code)
        return res;
      const guild = this.playingUser[session.userId];
      config.deBug && console.log(`用户群里绑定的群` + guild);
      if (!this.playGuild[guild]?.isPlay)
        return { code: false, msg: "未开始进行游戏 请先 /开始游戏" };
      this.updateSession(session);
      const user = this.playGuild[guild].playUser[session.userId];
      const msg = `${darkEyes.isMe(session)}你的身份是 「${infoRule.dict[user.duty]}」

 ${infoRule.info[user.duty]}`;
      return { code: true, msg };
    },
    // 结算投票
    async settlementReferendum(session) {
      const guild = this.playGuild[session.guildId];
      const lifeList = guild.nowTemp;
      let isSelectUser = 0;
      const len = lifeList.length;
      const bevoteList = lifeList.map((item, index) => {
        if (item.isVote)
          isSelectUser++;
        return item;
      });
      if (isSelectUser / len < 0.5) {
        await session.send("本轮参与投票的人数不够，无法处理...");
        return;
      }
      const maxNum = Math.max(...bevoteList.map((item) => item.beVoted));
      const maxUserList = bevoteList.filter((item) => item.beVoted === maxNum);
      if (maxUserList.length > 2) {
        await session.send(`票数相同，无法决定。本轮投票作废...`);
        return
      }
      const msg = [...maxUserList[0]].map((item) => {
        item.referendum = true;
        item.session && item.session.send(`你扮演的 ${item.characters.name} 已被投票，您可以留下 /遗言 提供给有用的信息`);
        return `大部分群众们认为 ${item.characters.name} 是大坏坏，ta被投票了出去...
ta 的身份是 「${infoRule.dict[item.duty]}」`;
      }).join("\n");
      await session.send(msg);
    },
    // 结算夜晚鲨内容
    async settlementCutTime(session) {
      const guild = this.playGuild[session.guildId];
      const lifeList = guild.nowTemp.filter((item) => item.duty === Duty.bandit);
      let isSelectUser = 0;
      const len = lifeList.length;
      const bevoteList = lifeList.map((item, index) => {
        if (item.isVote)
          isSelectUser++;
        return item;
      });
      if (!isSelectUser || isSelectUser / len < 0.5) {
        await session.send(`「${infoRule.dict[Duty.bandit]}」似乎睡着了，今晚没有杀人...`);
        return;
      }
      const maxNum = Math.max(...guild.nowTemp.map((item) => item.killBeVoted));
      const maxUserList = guild.nowTemp.filter((item) => item.killBeVoted === maxNum)[0];
      const msg = [maxUserList].map((item) => {
        if (item.isDie)
          return;
        if (!item.isHeal) {
          item.isDie = true;
          item.session.send(`你扮演的 ${item.characters.name} 已经阵亡，您可以留下 /遗言 提供给有用的信息`);
          return `早晨人们发现身份是「${infoRule.dict[item.duty]}」的${item.characters.name}躺在大街上。`;
        } else {
          item.session.send(`你被「${infoRule.dict[Duty.medic]}」救了一命`);
          return `虽然「${infoRule.dict[Duty.bandit]}」想对${item.characters.name}下手，但是被「${infoRule.dict[Duty.medic]}」救活了`;
        }
      }).join("\n");
      await session.send(msg);
    },
    // 结算夜晚查内容
    async settlementCheckTime(session) {
      const guild = this.playGuild[session.guildId];
      const lifeList = guild.nowTemp.filter((item) => item.duty === Duty.detective);
      let isSelectUser = 0;
      const len = lifeList.length;
      config.deBug && console.log(`探员队列信息`);
      config.deBug && console.log(lifeList);
      const bevoteList = lifeList.map((item, index) => {
        config.deBug && console.log(lifeList);
        if (item.isVote)
          isSelectUser++;
        return item;
      });
      if (isSelectUser == 0) {
        await session.send(`「${infoRule.dict[Duty.detective]}」探员们昨晚什么事情也没做...`);
        return;
      }
      const maxNum = Math.max(...guild.nowTemp.map((item) => item.checkBevoted));
      const maxUserList = guild.nowTemp.filter((item) => item.checkBevoted === maxNum)[0];
      const msg = [maxUserList].map((item) => {
        if (item.checkVote / len > 0.5) {
          item.isCheck = true;
        }
        return `查出目标 ${item.characters.name} 的身份是：「${infoRule.dict[item.duty]}」`;
      }).join("\n");
      lifeList.forEach((item) => {
        item.session.send(msg);
      });
    },
    // 重置投票信息
    clerReferendum(session) {
      Object.keys(this.playGuild[session.guildId].playUser).forEach((item) => {
        darkEyes.playGuild[session.guildId].playUser[item].isVote = false;
        darkEyes.playGuild[session.guildId].playUser[item].isHeal = false;
        darkEyes.playGuild[session.guildId].playUser[item].isSetHit = false;
        darkEyes.playGuild[session.guildId].playUser[item].isSetHeal = false;
        darkEyes.playGuild[session.guildId].playUser[item].beVoted = 0;
        darkEyes.playGuild[session.guildId].playUser[item].killBeVoted = 0;
        darkEyes.playGuild[session.guildId].stopCheck = false;
      });
    },
    // 验证是否开启游戏
    verifyIsPlay(session, errMsg = "还未开启游戏，请先 /创建游戏") {
      if (!session.guildId)
        return { code: false, msg: "该功能请在群内操作" };
      if (!this.playGuild[session.guildId])
        return { code: false, msg: errMsg };
      if (!this.playGuild[session.guildId].playUser[session.userId])
        return { code: false, msg: "你并未参与游戏，无法使用功能" };
      return { code: true, msg: "" };
    },
    // 验证是否开启游戏
    verifyIsPrivatePlay(session, errMsg = "还未创建游戏，请先在群里 /创建游戏") {
      if (session.guildId)
        return { code: false, msg: "" };
      const guildId = this.playingUser[session.userId];
      if (!this.playGuild[guildId])
        return { code: false, msg: errMsg };
      if (!this.playGuild[guildId]?.playUser[session.userId])
        return { code: false, msg: "你并未参与游戏，无法使用功能" };
      return { code: true, msg: "" };
    },
    // 更新 session 数据
    updateSession(session) {
      if (session.guildId)
        return;
      if (!this.playingUser[session.userId])
        return;
      const guildId = this.playingUser[session.userId];
      config.deBug && console.log(this.playingUser);
      if (guildId) {
        config.deBug && console.log(guildId + "->更新最新的私聊 session");
        this.playGuild[guildId].playUser[session.userId].session = session;
      }
    },
    // 更新群 session 数据
    updateGuildId(session) {
      if (session.guildId) {
        if (!this.playGuild[session.userId])
          return;
        config.deBug && console.log(session.guildId + "->更新最新的群session");
        this.playGuild[session.guildId].session = session;
      }
    }
  };

  ctx
    .command('天黑请闭眼')

  ctx
    .command('开始游戏')
    .action(async ({ session }) => {
      const res = await darkEyes.startPlay(session)
      await session.send(res)
    })

  ctx
    .command('天黑请闭眼/投票 <th_id:number>')
    .action(async ({ session }, th_id) => {
      if (!th_id) {
        session.send('请填入需要投票目标的序号！')
        return
      }
      darkEyes.updateGuildId(session)
      const res = darkEyes.setVote(session, th_id)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
      await session.send(darkEyes.battleReport(session).msg)
    })
  ctx
    .command('天黑请闭眼/杀 <th_id:number>')
    .action(async ({ session }, th_id) => {
      if (!th_id) {
        session.send('请填入需要投票目标的序号！')
        return
      }
      darkEyes.updateSession(session)
      const res = darkEyes.cutVote(session, th_id)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
      await session.send(darkEyes.battleReport(session, Duty.bandit).msg)
    })

  ctx
    .command('天黑请闭眼/查 <th_id:number>')
    .action(async ({ session }, th_id) => {
      if (!th_id) {
        session.send('请填入需要投票目标的序号！')
        return
      }
      darkEyes.updateSession(session)
      const res = darkEyes.checkVote(session, th_id)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
      await session.send(darkEyes.battleReport(session, Duty.detective).msg)
    })

  ctx
    .command('天黑请闭眼/狙 <th_id:number>')
    .action(async ({ session }, th_id) => {
      if (!th_id) {
        session.send('请填入需要选择目标的序号！')
        return
      }
      darkEyes.updateSession(session)
      const res = darkEyes.hitVote(session, th_id)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/针 <th_id:number>')
    .action(async ({ session }, th_id) => {
      if (!th_id) {
        session.send('请填入需要选择目标的序号！')
        return
      }
      darkEyes.updateSession(session)
      const res = darkEyes.healVote(session, th_id)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/遗言 <msg:text>')
    .action(async ({ session }, msg) => {
      darkEyes.updateSession(session)
      const res = await darkEyes.tallLastWords(session, msg)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/聊 <msg:text>')
    .action(async ({ session }, msg) => {
      darkEyes.updateSession(session)
      const res = await darkEyes.talkUser(session, msg)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/身份')
    .action(async ({ session }) => {
      darkEyes.updateSession(session)
      const res = await darkEyes.askStanding(session)
      if (!res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/创建游戏')
    .action(async ({ session }) => {
      const res = await darkEyes.readyPlay(session)
      if (res.code) {
        await session.send(res.msg)
        return
      }
      config.deBug && console.log(session);

      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/结束游戏')
    .action(async ({ session }) => {
      const res = await darkEyes.clearPlay(session)
      if (res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  ctx
    .command('天黑请闭眼/加入游戏')
    .action(async ({ session }) => {
      const res = await darkEyes.addPlay(session)
      if (res.code) {
        await session.send(res.msg)
        return
      }
      await session.send(res.msg)
    })

  const tool = {
    // 获取指定范围的真随机数
    random(min: number, max: number) {
      return Math.floor(Math.random() * (max - min) + min);
    },
    // 打乱数组
    getFreeList(arr) {
      let arrAdd = [...arr];
      for (let i = 1; i < arrAdd.length; i++) {
        const random = Math.floor(Math.random() * (i + 1));
        //交换两个数组
        [arrAdd[i], arrAdd[random]] = [arrAdd[random], arrAdd[i]];
      }
      return arrAdd;
    }
  }

  ctx.middleware(async (session, next) => {
    if (session.guildId) {
      darkEyes.updateGuildId(session)
    } else {
      darkEyes.updateSession(session)
    }
    return await next()
  }, true)

  ctx.on('ready', () => {
    darkEyes.init()
  })
}
