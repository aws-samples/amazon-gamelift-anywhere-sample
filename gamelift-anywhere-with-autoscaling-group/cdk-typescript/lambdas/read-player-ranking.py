import redis
import os

redis_host = os.getenv('REDIS')
redis = redis.Redis(host=redis_host, db=0)

def lambda_handler(event, context):
    result = redis.zrevrange('Rating', 0, -1, True)
    print(result)
    ret = []
    for entry in result:
        ret.append({ 'Player': entry[0].decode('utf-8'), 'Score': int(entry[1]) })

    print(ret)
    return ret