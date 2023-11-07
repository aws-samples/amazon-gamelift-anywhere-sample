/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

package main

import (
	"aws/amazon-gamelift-go-sdk/model"
	"aws/amazon-gamelift-go-sdk/model/request"
	"aws/amazon-gamelift-go-sdk/server"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/sqs"
	"github.com/aws/aws-sdk-go-v2/service/sqs/types"

	"github.com/aws/aws-sdk-go-v2/service/gamelift"
)

type GameLiftManager struct {
	mGameSession           *GameSession
	mPlayerReadyCount      int
	mCheckTerminationCount int
	mActivated             bool
	mRegion                string

	mSQSUrl        string
	mStateFilename string // for maintaining game session state (IDLE or ACTIVE)
}

/*
type gameProcess struct {
	Port int
	Logs server.LogParameters
}
*/

func (g *GameLiftManager) LoadConfig(ctx context.Context) aws.Config {
	if g.mRegion == "" {
		cfg, err := config.LoadDefaultConfig(ctx)
		if err != nil {
			panic("configuration error, " + err.Error())
		}
		return cfg
	} else {
		cfg, err := config.LoadDefaultConfig(ctx, config.WithRegion(g.mRegion))
		if err != nil {
			panic("configuration error, " + err.Error())
		}
		return cfg
	}
}

func (g *GameLiftManager) OnStartGameSession(model.GameSession) {
	// When a game session is created,
	// GameLift sends an activation request to the game server and passes
	// along the game session object containing game properties and other settings.
	// Here is where a game server should take action based on the game session object.
	// Once the game server is ready to receive incoming player connections,
	// it should invoke server.ActivateGameSession()

	//FastSpinlockGuard lock(mLock);
	err := server.ActivateGameSession()
	if err != nil {
		myLogger.Fatal(err.Error())
	}
	myLogger.Println("[GameLift] OnStartGameSession")

	g.mGameSession = &GameSession{
		mPlayerBlack: nil,
		mPlayerWhite: nil,
		mGameStatus:  GS_NOT_STARTED,
		mCurrentTurn: STONE_NONE,

		mGameLiftManager: g,
	}

	cmd_string := "echo ACTIVE > " + g.mStateFilename
	cmd := exec.Command("bash", "-c", cmd_string)
	stdout, err2 := cmd.Output()
	if err2 != nil {
		myLogger.Println("Error in writing state file: ", err2)
	} else {
		myLogger.Println("State file written: ", string(stdout))
	}

	//mMatchMakerData = g.mGameSession.GetMatchmakerData()
}

func (g *GameLiftManager) OnUpdateGameSession(model.UpdateGameSession) {
	// When a game session is updated (e.g. by FlexMatch backfill),
	// GameLift sends a request to the game
	// server containing the updated game session object.
	// The game server can then examine the provided
	// MatchmakerData and handle new incoming players appropriately.
	// UpdateReason is the reason this update is being supplied.
	myLogger.Print("OnUpdateGameSession")
}

func (g *GameLiftManager) OnProcessTerminate() {
	//FastSpinlockGuard lock(mLock);

	// It gives this game server a chance to save its state,
	// communicate with services, etc., before being shut down.
	// In this case, we simply tell GameLift we are indeed going to shutdown.

	// game-specific tasks required to gracefully shut down a game session,
	// such as notifying players, preserving game state data, and other cleanup
	if g.mActivated {
		myLogger.Print("[GAMELIFT] OnProcessTerminate Success\n")
		g.TerminateGameSession(0xDEAD)
	}
}

func (g *GameLiftManager) TerminateGameSession(exitCode int) {
	server.ProcessEnding()

	g.mActivated = false

	os.Exit(exitCode)
}

func (g *GameLiftManager) OnHealthCheck() bool {
	// GameLift will invoke this callback every HEALTHCHECK_INTERVAL times (60 sec by default, with jitter.)
	// Here, a game server might want to check the health of dependencies and such.
	// Simply return true if healthy, false otherwise.
	// The game server has HEALTHCHECK_TIMEOUT interval (60 sec by default) to respond with its health status.
	// GameLift will default to 'false' if the game server doesn't respond in time.
	// In this case, we're always healthy!
	myLogger.Print("OnHealthCheck: ", g.mActivated)
	return g.mActivated
}

func (g *GameLiftManager) InitializeGameLift(listenPort int, gameliftEndpoint string, fleetId string, hostId string, logPath string) bool {
	var err error

	if (hostId != "") && (fleetId != "") {
		myLogger.Print("InitializeGameLift in anywhere fleet mode")

		ctx := context.TODO()
		cfg := g.LoadConfig(ctx)
		svc := gamelift.NewFromConfig(cfg)
		output, err := svc.GetComputeAuthToken(ctx,
			&gamelift.GetComputeAuthTokenInput{
				ComputeName: aws.String(hostId),
				FleetId:     aws.String(fleetId),
			})

		if err != nil {
			myLogger.Fatal(err.Error())
		}

		err = server.InitSDK(server.ServerParameters{
			WebSocketURL: gameliftEndpoint,
			ProcessID:    strconv.Itoa(os.Getpid()),
			HostID:       hostId,
			FleetID:      fleetId,
			AuthToken:    *output.AuthToken,
		})
	} else {
		myLogger.Print("InitializeGameLift in managed fleet mode")
		serverParameters := server.ServerParameters{"", "", "", "", ""}

		//InitSDK establishes a local connection with GameLift's agent to enable further communication.
		err = server.InitSDK(serverParameters)
	}

	if err != nil {
		myLogger.Print("InitSDK failed : ", err.Error())
		myLogger.Fatal(err.Error())
	}
	// Make sure to call server.Destroy() when the application quits.
	// This resets the local connection with GameLift's agent.
	myLogger.Print("Calling ProcessReady port : ", listenPort)

	err = server.ProcessReady(server.ProcessParameters{
		OnStartGameSession:  g.OnStartGameSession,
		OnUpdateGameSession: g.OnUpdateGameSession,
		OnProcessTerminate:  g.OnProcessTerminate,
		OnHealthCheck:       g.OnHealthCheck,
		LogParameters: server.LogParameters{
			LogPaths: []string{"/local/game/logfile.txt"},
		},
		Port: listenPort,
	})
	if err != nil {
		myLogger.Print("ProcessReady failed : ", err.Error())
		myLogger.Fatal(err.Error())
	}

	g.mActivated = true
	myLogger.Println("ProcessReady... : ", g.mActivated)

	g.mStateFilename = "/tmp/" + strconv.Itoa(listenPort) + ".state"
	cmd_string := "echo IDLE > " + g.mStateFilename
	cmd := exec.Command("bash", "-c", cmd_string)
	stdout, err2 := cmd.Output()
	if err2 != nil {
		myLogger.Println("Error in writing state file: ", err2)
	} else {
		myLogger.Println("State file written: ", string(stdout))
	}
	return true
}


func (g *GameLiftManager) SendGameResultToSQS(blackJson string, whiteJson string) {
	// Authenticate and send message to SQS queue
	ctx := context.TODO()
	cfg := g.LoadConfig(ctx)
	svc := sqs.NewFromConfig(cfg)

	sMInput := &sqs.SendMessageBatchInput{
		Entries: []types.SendMessageBatchRequestEntry{
			// First message
			{
				Id:          aws.String("msg_player_001"),
				MessageBody: aws.String(blackJson),
			},
			{
				Id:          aws.String("msg_player_002"),
				MessageBody: aws.String(whiteJson),
			},
		},
		QueueUrl: &g.mSQSUrl,
	}

	resp, err := svc.SendMessageBatch(ctx, sMInput)
	if err != nil {
		fmt.Println("Got an error sending the message:")
		fmt.Println(err)
		return
	}

	myLogger.Println("Sent message with ID: " + *resp.Successful[0].MessageId)
}

func (g *GameLiftManager) FinalizeGameLift() {
	server.Destroy()
}

func (g *GameLiftManager) AcceptPlayerSession(psess *PlayerSession, playerSessionId string) bool {
	//FastSpinlockGuard lock(mLock);

	err := server.AcceptPlayerSession(playerSessionId)
	if err != nil {
		myLogger.Print("[GAMELIFT] AcceptPlayerSession Fail: \n", err.Error())
		return false
	} else {
		g.mGameSession.PlayerEnter(psess)
		return true
	}
}

func (g *GameLiftManager) RemovePlayerSession(psess *PlayerSession, playerSessionId string) {
	//FastSpinlockGuard lock(mLock);

	myLogger.Print("RemovePlayerSession : ", psess, playerSessionId)
	err := server.RemovePlayerSession(playerSessionId)
	if err != nil {
		myLogger.Print("[GAMELIFT] RemovePlayerSession Fail: ", err.Error())
	} else {
		g.mGameSession.PlayerLeave(psess)
	}

	g.mCheckTerminationCount = g.mCheckTerminationCount + 1
	if g.mCheckTerminationCount < MAX_PLAYER_PER_GAME {
		return
	}

	if g.mGameSession.IsEnd() && g.mActivated {
		myLogger.Print("[GAMELIFT] Terminate GameSession\n")
		g.TerminateGameSession(37)
	}
}

func (g *GameLiftManager) DescribePlayerSessions(playerSessionId string) (*model.PlayerSession, error) {
	describePlayerSessionsRequest := request.NewDescribePlayerSessions()
	describePlayerSessionsRequest.PlayerSessionID = playerSessionId

	describePlayerSessionsResponse, err := server.DescribePlayerSessions(describePlayerSessionsRequest)
	if err != nil {
		myLogger.Print("[GAMELIFT] DescribePlayerSessions Failed: ", err.Error())
		return nil, err
	}

	return &describePlayerSessionsResponse.PlayerSessions[0], nil
}

func (g *GameLiftManager) CheckReadyAll() {

	//	if (MAX_PLAYER_PER_GAME != InterlockedIncrement(&mPlayerReadyCount))
	//		return;

	g.mPlayerReadyCount = g.mPlayerReadyCount + 1
	if g.mPlayerReadyCount != MAX_PLAYER_PER_GAME {
		return
	}

	g.mGameSession.BroadcastGameStart()
}

func (g *GameLiftManager) SetStateFilename(filename string) {
	g.mStateFilename = filename
}

/*
func (g *GameLiftManager) FindScoreFromMatchData(string playerName) int {
	std::string err;
	const auto json = Json::parse(mMatchMakerData, err);

	for (auto& team : json["teams"].array_items())
	{
		for (auto& player : team["players"].array_items())
		{
			if (player["playerId"].string_value() == playerName)
			{
				return player["attributes"]["score"]["valueAttribute"].int_value();
			}
		}
	}

	return 0;
}
*/
