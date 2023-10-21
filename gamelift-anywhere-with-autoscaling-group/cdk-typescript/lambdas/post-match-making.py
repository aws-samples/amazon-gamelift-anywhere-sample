import boto3
import sys
import json
import decimal
import os
import logging

logger = logging.getLogger()

logger.setLevel(logging.DEBUG)

# Helper class to convert a DynamoDB item to JSON.
class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, decimal.Decimal):
            if o % 1 > 0:
                return float(o)
            else:
                return int(o)
        return super(DecimalEncoder, self).default(o)
        

region_name = os.getenv('AWS_REGION')
table_name = os.getenv('TABLE_NAME')
matchmaking_configuration_name = os.getenv('MATCHMAKING_CONFIGURATION_NAME')

gamelift = boto3.client('gamelift')
dynamodb = boto3.resource('dynamodb', region_name=region_name)
ddb_table = dynamodb.Table(table_name)

def lambda_handler(event, context):
    playerName = event['PlayerName']
    playerScore = -1
    
    result = ddb_table.get_item( Key= { 'PlayerName' : playerName } )

    if 'Item' not in result:
        # Create Item
        ddb_table.put_item( Item={ 'PlayerName' : playerName, 'Score' : 1000, 'Win' : 0, 'Lose' : 0, 'LeaderboardName': 'Score' } )
        playerScore = 1000
    else:
        playerScore = result['Item']['Score']

    playerAttr = { 'score': { 'N': int(playerScore) } }
    
    # Auth OK, Match Request Go
    match_response = gamelift.start_matchmaking(
        ConfigurationName=matchmaking_configuration_name,
        Players = [ { 'PlayerId' : playerName, 'PlayerAttributes' : playerAttr } ]
    )

    logger.debug(match_response)
    ticketId = match_response['MatchmakingTicket']['TicketId']

    return { 'TicketId' : ticketId }