angular.module('ngTeam').controller('teamController', function ($scope) {
	$scope.teams = [{
						id: 1,
						name: 'Team 1'
					},
					{
						id: 2,
						name: 'Team 2'
					},
					{
						id:3,
						name: 'Team 3'
					}];
});