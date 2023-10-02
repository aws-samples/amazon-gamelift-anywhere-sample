import redis
import os

redis_host = os.getenv('REDIS')
redis = redis.Redis(host=redis_host, db=0)

def lambda_handler(event, context):
    result = redis.zrevrange('Rating', 0, -1, True)
    print(result)
    flat_list = [item for sublist in result for item in sublist]
    ret = []
    for i in range(0, len(flat_list)):
        if ( i % 2 == 0 ):
            org = {}
            org['Player'] = flat_list[i].decode('utf-8')
            org['Score'] = int(flat_list[i+1])
            ret.append(org)
            
    return {
        'statusCode': 200,
        'headers': {
            'Content-Type': 'application/json',
        },
        'body': ret
    }