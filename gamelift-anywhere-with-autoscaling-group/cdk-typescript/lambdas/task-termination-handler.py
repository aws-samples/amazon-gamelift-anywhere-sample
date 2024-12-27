import boto3
import os
import logging
from botocore.exceptions import ClientError

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def lambda_handler(event, context):
    try:
        logger.info(f"Received event: {event}")
        
        # Extract task details from the event
        detail = event['detail']
        task_id = detail['taskArn'].split('/')[-1]
        
        # Get environment variables
        fleet_id = os.environ['GAMELIFT_FLEET_ID']
        
        # Create GameLift client
        gamelift_client = boto3.client('gamelift')
        
        try:
            # Call DeregisterCompute API
            response = gamelift_client.deregister_compute(
                FleetId=fleet_id,
                ComputeName=task_id
            )
            
            logger.info(f"Successfully deregistered compute {task_id} from fleet {fleet_id}")
            return {
                'statusCode': 200,
                'body': f"Successfully deregistered compute {task_id}"
            }
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'NotFoundException':
                logger.info(f"Compute {task_id} was already deregistered or not found")
                return {
                    'statusCode': 200,
                    'body': f"Compute {task_id} was already deregistered or not found"
                }
            else:
                raise e
                
    except Exception as e:
        logger.error(f"Error processing task termination: {str(e)}")
        return {
            'statusCode': 500,
            'body': f"Error deregistering compute: {str(e)}"
        }
