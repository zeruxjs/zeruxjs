/** Bounded fixed-window accounting. Only KEYS[1..2], same Cluster tag; server clock, no callbacks/retries. */
export const fixedWindowScript=`
redis.replicate_commands()
local hashType=redis.call('TYPE',KEYS[1]).ok
local expiryType=redis.call('TYPE',KEYS[2]).ok
if (hashType~='none' and hashType~='hash') or (expiryType~='none' and expiryType~='zset') then return redis.error_reply('LIMITER_STATE_TYPE') end
if (hashType=='none')~=(expiryType=='none') then return redis.error_reply('LIMITER_STATE_INCOMPLETE') end
if redis.call('HLEN',KEYS[1])~=redis.call('ZCARD',KEYS[2]) then return redis.error_reply('LIMITER_STATE_CARDINALITY') end
local subject=ARGV[1]
local window=tonumber(ARGV[2])
local maximum=tonumber(ARGV[3])
local weight=tonumber(ARGV[4])
local capacity=tonumber(ARGV[5])
local lifetime=tonumber(ARGV[6])
local time=redis.call('TIME')
local now=tonumber(time[1])*1000+math.floor(tonumber(time[2])/1000)
if weight>maximum then return {0,maximum,now+window,now,0} end
local expired=redis.call('ZRANGEBYSCORE',KEYS[2],'-inf',now,'LIMIT',0,128)
for _,field in ipairs(expired) do redis.call('HDEL',KEYS[1],field);redis.call('ZREM',KEYS[2],field) end
local reset=tonumber(redis.call('ZSCORE',KEYS[2],subject))
if reset and reset<=now then redis.call('HDEL',KEYS[1],subject);redis.call('ZREM',KEYS[2],subject);reset=nil end
local raw=redis.call('HGET',KEYS[1],subject)
if (reset and not raw) or (not reset and raw) then return redis.error_reply('LIMITER_STATE_MEMBER') end
if reset and (reset~=math.floor(reset) or reset>now+lifetime) then return redis.error_reply('LIMITER_STATE_TIME') end
local count=tonumber(raw or '0')
if not count or count<0 or count>1000000 or count~=math.floor(count) then return redis.error_reply('LIMITER_STATE_COUNT') end
if not reset then
 if redis.call('ZCARD',KEYS[2])>=capacity or redis.call('HLEN',KEYS[1])>=capacity then
  local earliest=redis.call('ZRANGE',KEYS[2],0,0,'WITHSCORES')
  local retry=tonumber(earliest[2]) or now+lifetime
  return {0,0,math.max(now+1,retry),now,1}
 end
 reset=now+window
 count=0
end
local allowed=0
if count+weight<=maximum then
 count=count+weight
 redis.call('HSET',KEYS[1],subject,count)
 redis.call('ZADD',KEYS[2],reset,subject)
 redis.call('PEXPIRE',KEYS[1],lifetime)
 redis.call('PEXPIRE',KEYS[2],lifetime)
 allowed=1
end
return {allowed,math.max(0,maximum-count),reset,now,0}
`;
