//  addin for bootstrap typeahead
//  shows list on click, focus and using cookie for last 3 items

angular.module('ui.bootstrap.typeahead', ['ui.bootstrap.position', 'ngCookies'])
  .factory('typeaheadParser', ['$parse', function ($parse) {
      //                      00000111000000000000022200000000000000003333333333333330000000000044000
      var TYPEAHEAD_REGEXP = /^\s*(.*?)(?:\s+as\s+(.*?))?\s+for\s+(?:([\$\w][\$\w\d]*))\s+in\s+(.*)$/;

      return {
          parse: function (input) {
              var match = input.match(TYPEAHEAD_REGEXP), modelMapper, viewMapper, source;
              if (!match) {
                  throw new Error(
                    "Expected typeahead specification in form of '_modelValue_ (as _label_)? for _item_ in _collection_'" +
                      " but got '" + input + "'.");
              }

              return {
                  itemName: match[3],
                  source: $parse(match[4]),
                  viewMapper: $parse(match[2] || match[1]),
                  modelMapper: $parse(match[1])
              };
          }
      };
  }])

  .directive('typeahead', ['$compile', '$parse', '$q', '$timeout', '$document', '$position', 'typeaheadParser', '$cookieStore',
    function ($compile, $parse, $q, $timeout, $document, $position, typeaheadParser, $cookieStore) {
        var HOT_KEYS = [9, 13, 27, 38, 40];

        return {
            require: ['typeahead', 'ngModel'],
            controller: function TypeaheadController() {
                // Use controller to sync up stuff
                this.matches = [];
                this.cookiematches = [];
                this.usecookie = false;
                this.active = -1;
                //we need to propagate user's query so we can higlight matches
                this.query = undefined;

                this.resetMatches = function () {
                    this.cookiematches = [];
                    this.matches = [];
                    this.active = -1;
                };
            },
            link: function (originalScope, element, attrs, controllers) {
                var typeaheadCtrl = controllers[0],
                    modelCtrl = controllers[1];

                //SUPPORTED ATTRIBUTES (OPTIONS)

                //minimal no of characters that needs to be entered before typeahead kicks-in
                var minSearch = originalScope.$eval(attrs.typeaheadMinLength) || 1;

                //minimal wait time after last character typed before typehead kicks-in
                var waitTime = originalScope.$eval(attrs.typeaheadWaitMs) || 0;

                //should it restrict model values to the ones selected from the popup only?
                var isEditable = originalScope.$eval(attrs.typeaheadEditable) !== false;

                //binding to a variable that indicates if matches are being retrieved asynchronously
                var isLoadingSetter = $parse(attrs.typeaheadLoading).assign || angular.noop;

                //a callback executed when a match is selected
                var onSelectCallback = $parse(attrs.typeaheadOnSelect);

                var inputFormatter = attrs.typeaheadInputFormatter ? $parse(attrs.typeaheadInputFormatter) : undefined;

                //INTERNAL VARIABLES

                //model setter executed upon match selection
                var $setModelValue = $parse(attrs.ngModel).assign;

                //expressions used by typeahead
                var parserResult = typeaheadParser.parse(attrs.typeahead);

                //pop-up element used to display matches
                var popUpEl = angular.element('<typeahead-popup></typeahead-popup>');
                popUpEl.attr({
                    usecookie: 'typeaheadCtrl.usecookie',
                    cookiematches: 'typeaheadCtrl.cookiematches',
                    matches: 'typeaheadCtrl.matches',
                    active: 'typeaheadCtrl.active',
                    select: 'typeaheadCtrl.select(activeIdx)',
                    selectcookie: 'typeaheadCtrl.selectcookie(activeName)',
                    query: 'typeaheadCtrl.query',
                    position: 'position'
                });
                //custom item template
                if (angular.isDefined(attrs.typeaheadTemplateUrl)) {
                    popUpEl.attr('template-url', attrs.typeaheadTemplateUrl);
                }

                //create a child scope for the typeahead directive so we are not polluting original scope
                //with typeahead-specific data (matches, query etc.)
                var scope = originalScope.$new();
                //share typeaheadCtrl through scope (since this popUpEl is a sibling, can't use require)
                scope.typeaheadCtrl = typeaheadCtrl;

                originalScope.$on('$destroy', function () {
                    scope.$destroy();
                });


                typeaheadCtrl.cookieOnOff = function (inputValue) {
                    typeaheadCtrl.usecookie = inputValue;
                }

                typeaheadCtrl.getMatchesAsync = function (inputValue, cookieName) {
                    typeaheadCtrl.cookieName = cookieName;

                    var locals = { $viewValue: inputValue };
                    isLoadingSetter(originalScope, true);
                    $q.when(parserResult.source(scope, locals)).then(function (matches) {
                        //it might happen that several async queries were in progress if a user were typing fast
                        //but we are interested only in responses that correspond to the current view value
                        if (inputValue === modelCtrl.$viewValue) {
                            if (matches.length > 0) {
                                typeaheadCtrl.active = 0;
                                typeaheadCtrl.matches.length = 0;

                                //transform labels
                                for (var i = 0; i < matches.length; i++) {
                                    locals[parserResult.itemName] = matches[i];
                                    typeaheadCtrl.matches.push({
                                        label: parserResult.viewMapper(scope, locals),
                                        model: matches[i]
                                    });
                                }

                                typeaheadCtrl.query = inputValue;
                                //position pop-up with matches - we need to re-calculate its position each time we are opening a window
                                //with matches as a pop-up might be absolute-positioned and position of an input might have changed on a page
                                //due to other elements being rendered
                                scope.position = $position.position(element);
                                scope.position.top = scope.position.top + element.prop('offsetHeight');



                                //loads cookies to scope
                                if (typeaheadCtrl.usecookie) {
                                    var cookieMatch = $cookieStore.get(typeaheadCtrl.cookieName);
                                    if (_.isUndefined(cookieMatch)) {
                                        cookieMatch = [];
                                    }

                                    typeaheadCtrl.cookiematches = [];
                                    for (var i = 0; i < cookieMatch.length; i++) {
                                        typeaheadCtrl.cookiematches.push({
                                            label: cookieMatch[i].label,
                                            model: cookieMatch[i].model
                                        });
                                    }
                                }


                            } else {
                                typeaheadCtrl.resetMatches();
                            }
                            isLoadingSetter(originalScope, false);
                        }
                    }, function () {
                        typeaheadCtrl.resetMatches();
                        isLoadingSetter(originalScope, false);
                    });
                };

                typeaheadCtrl.resetMatches();

                //Declare the timeout promise var outside the function scope so that stacked calls can be cancelled later
                var timeoutPromise;

                //plug into $parsers pipeline to open a typeahead on view changes initiated from DOM
                //$parsers kick-in on all the changes coming from the view as well as manually triggered by $setViewValue
                modelCtrl.$parsers.unshift(function (inputValue) {
                    typeaheadCtrl.resetMatches();
                    if (inputValue && inputValue.length >= minSearch || inputValue == "") {
                        if (waitTime > 0) {
                            if (timeoutPromise) {
                                $timeout.cancel(timeoutPromise);//cancel previous timeout
                            }
                            timeoutPromise = $timeout(function () {
                                typeaheadCtrl.getMatchesAsync(inputValue);
                            }, waitTime);
                        } else {
                            typeaheadCtrl.getMatchesAsync(inputValue);
                        }
                    }

                    if (isEditable) {
                        return inputValue;
                    } else {
                        modelCtrl.$setValidity('editable', false);
                        return undefined;
                    }
                });

                modelCtrl.$formatters.push(function (modelValue) {
                    var candidateViewValue, emptyViewValue;
                    var locals = {};

                    if (inputFormatter) {
                        locals['$model'] = modelValue;
                        return inputFormatter(originalScope, locals);
                    } else {
                        //it might happen that we don't have enough info to properly render input value
                        //we need to check for this situation and simply return model value if we can't apply custom formatting
                        locals[parserResult.itemName] = modelValue;
                        candidateViewValue = parserResult.viewMapper(originalScope, locals);
                        locals[parserResult.itemName] = undefined;
                        emptyViewValue = parserResult.viewMapper(originalScope, locals);

                        return candidateViewValue !== emptyViewValue ? candidateViewValue : modelValue;
                    }
                });


                typeaheadCtrl.selectcookie = function (activeName) {
                    //called from within the $digest() cycle
                    var locals = {};
                    var model, item;

                    locals[parserResult.itemName] = item = _.findWhere(typeaheadCtrl.cookiematches, { label: activeName.label }).model;
                    model = parserResult.modelMapper(originalScope, locals);
                    $setModelValue(originalScope, model);
                    modelCtrl.$setValidity('editable', true);

                    var label = parserResult.viewMapper(originalScope, locals);
                    onSelectCallback(originalScope, {
                        $item: item,
                        $model: model,
                        $label: label
                    });

                    typeaheadCtrl.resetMatches();
                }

                typeaheadCtrl.select = function (activeIdx) {
                    //called from within the $digest() cycle
                    var locals = {};
                    var model, item;

                    locals[parserResult.itemName] = item = typeaheadCtrl.matches[activeIdx].model;
                    model = parserResult.modelMapper(originalScope, locals);
                    $setModelValue(originalScope, model);
                    modelCtrl.$setValidity('editable', true);

                    var label = parserResult.viewMapper(originalScope, locals);
                    onSelectCallback(originalScope, {
                        $item: item,
                        $model: model,
                        $label: label
                    });

                    typeaheadCtrl.resetMatches();




                    //top 3 searchs from cookies
                    if (typeaheadCtrl.usecookie) {
                        var cookieMatch = $cookieStore.get(typeaheadCtrl.cookieName);
                        var notExist = true;

                        if (_.isUndefined(cookieMatch)) {
                            cookieMatch = [];
                        }
                        else {
                            var findItem = _.findWhere(cookieMatch, { label: label });
                            notExist = _.isUndefined(findItem);
                        }

                        if (cookieMatch.length >= 3 && notExist) {
                            cookieMatch.pop(); //always removes older item

                            //adds new item to first position
                            cookieMatch.unshift({
                                label: label,
                                model: model
                            });

                            //clears old list and adds new list
                            $cookieStore.remove(typeaheadCtrl.cookieName);
                            $cookieStore.put(typeaheadCtrl.cookieName, cookieMatch);
                        }
                        else if (notExist) {
                            //loads new item to list
                            cookieMatch.push({
                                label: label,
                                model: model
                            });

                            $cookieStore.put(typeaheadCtrl.cookieName, cookieMatch);
                        }

                        //adds list to scope
                        for (var i = 0; i < cookieMatch.length; i++) {
                            typeaheadCtrl.cookiematches.push({
                                label: cookieMatch[i].label,
                                model: model
                            });
                        }
                    }


                    //return focus to the input element if a mach was selected via a mouse click event
                    element[0].focus();
                };

                //bind keyboard events: arrows up(38) / down(40), enter(13) and tab(9), esc(27)
                element.bind('keydown', function (evt) {
                    //typeahead is open and an "interesting" key was pressed
                    if (typeaheadCtrl.matches.length === 0 || HOT_KEYS.indexOf(evt.which) === -1) {
                        return;
                    }

                    evt.preventDefault();

                    if (evt.which === 40) {
                        typeaheadCtrl.active = (typeaheadCtrl.active + 1) % typeaheadCtrl.matches.length;
                        scope.$digest();
                    } else if (evt.which === 38) {
                        typeaheadCtrl.active = (typeaheadCtrl.active ? typeaheadCtrl.active : typeaheadCtrl.matches.length) - 1;
                        scope.$digest();
                    } else if (evt.which === 13 || evt.which === 9) {
                        scope.$apply(function () {
                            typeaheadCtrl.select(typeaheadCtrl.active);
                        });
                    } else if (evt.which === 27) {
                        evt.stopPropagation();

                        typeaheadCtrl.resetMatches();
                        scope.$digest();
                    }
                });

                // Keep reference to click handler to unbind it.
                var dismissClickHandler = function (evt) {
                    if (element[0] !== evt.target) {
                        typeaheadCtrl.resetMatches();
                        scope.$digest();
                    }
                };

                $document.bind('click', dismissClickHandler);

                originalScope.$on('$destroy', function () {
                    $document.unbind('click', dismissClickHandler);
                });

                element.after($compile(popUpEl)(scope));
            }
        };
    }])

  .directive('typeaheadPopup', function () {
      return {
          restrict: 'E',
          scope: {
              usecookie: '=',
              cookiematches: '=',
              matches: '=',
              query: '=',
              active: '=',
              position: '=',
              select: '&',
              selectcookie: '&'
          },
          replace: true,
          templateUrl: 'template/typeahead/typeahead-popup.html',
          link: function (scope, element, attrs) {
              scope.templateUrl = attrs.templateUrl;

              scope.isOpen = function () {
                  return scope.matches.length > 0;
              };

              scope.isActive = function (matchIdx) {
                  return scope.active == matchIdx;
              };

              scope.selectActive = function (matchIdx) {
                  scope.active = matchIdx;
              };

              scope.selectMatch = function (activeIdx) {
                  scope.select({ activeIdx: activeIdx });
              };

              scope.selectActiveCookie = function (matchName) {
                  scope.active = matchIdx;
              };

              scope.selectMatchCookie = function (activeName) {
                  scope.selectcookie({ activeName: activeName });
              };
          }
      };
  })
  .directive('typeaheadMatch', ['$http', '$templateCache', '$compile', '$parse', function ($http, $templateCache, $compile, $parse) {
      return {
          restrict: 'E',
          scope: {
              index: '=',
              match: '=',
              query: '='
          },
          link: function (scope, element, attrs) {
              var tplUrl = $parse(attrs.templateUrl)(scope.$parent) || 'template/typeahead/typeahead-match.html';
              $http.get(tplUrl, { cache: $templateCache }).success(function (tplContent) {
                  element.replaceWith($compile(tplContent.trim())(scope));
              });
          }
      };
  }])


  .directive('typeaheadCookie', function () {
      return {
          require: ['typeahead', 'ngModel'],
          link: {
              pre: function (scope, element, attr, ctrls) {
                  element.bind('click', function () {
                      var cookieOn = attr.typeaheadCookie === 'true';
                      ctrls[0].cookieOnOff(cookieOn);
                  });
              }
          }
      }
  })
  .directive('typeaheadOpenOnFocus', function () {
      //control typeahead to show list on click
      return {
          require: ['typeahead', 'ngModel'],
          link: {
              post: function (scope, element, attr, ctrls) {
                  element.bind('click', function () {
                      var cookieName = "".concat(scope.$id, scope.$parent.$id);

                      ctrls[0].getMatchesAsync(ctrls[1].$viewValue, cookieName);
                      scope.$apply();
                  });
              }
          }
      }
  })

angular.module("template/typeahead/typeahead-match.html", ['ngCookies']).run(["$templateCache", function ($templateCache) {
    $templateCache.put("template/typeahead/typeahead-match.html",
      "<a class=\"mouseHand\" tabindex=\"-1\" ng-bind-html-unsafe=\"match.label | typeaheadHighlight:query\">{{match.label}}</a>");
}]);

angular.module("template/typeahead/typeahead-popup.html", ['ngCookies']).run(["$templateCache", function ($templateCache) {
    $templateCache.put("template/typeahead/typeahead-popup.html",
      "<div>\n" +
      "    <ul class=\"typeahead dropdown-menu\" ng-style=\"{display: isOpen()&&'block' || 'none', top: position.top+'px', left: position.left+'px'}\">\n" +
      "     <p ng-if=\"usecookie && cookiematches.length\" style=\"font-weight: bold;margin: 2%\">Utilizados recentemente</p>\n" +
      "     <li ng-if=\"usecookie\" ng-repeat=\"match in cookiematches\" ng-click=\"selectMatchCookie(match)\">\n" +
      "        <typeahead-match  match=\"match\" query=\"query\" template-url=\"templateUrl\"></typeahead-match>\n" +
      "     </li>\n" +

      "     <p style=\"font-weight: bold;margin: 2%\">Todos</p>\n" +
      "     <li ng-repeat=\"match in matches\" ng-class=\"{active: isActive($index) }\" ng-mouseenter=\"selectActive($index)\" ng-click=\"selectMatch($index)\">\n" +
      "        <typeahead-match index=\"$index\" match=\"match\" query=\"query\" template-url=\"templateUrl\"></typeahead-match>\n" +
      "     </li>\n" +
      "    </ul>\n" +
      "</div>");
}]);


// CLEARABLE BUTTON
function tog(v) {
    return v ? 'addClass' : 'removeClass';
}

$(document).on('input', '.clearable-input', function () {
    $('.clearable')[tog(this.value)]('x');
}).on('click', '.typeahead', function () {
    $('.x')[tog(this.offsetWidth - 18 < e.clientX - this.getBoundingClientRect().left)]('onX');
}).on('mousemove', '.x', function (e) {
    $(this)[tog(this.offsetWidth - 18 < e.clientX - this.getBoundingClientRect().left)]('onX');
}).on('touchstart click', '.onX', function (ev) {
    ev.preventDefault();
    $(this).removeClass('x onX').val('').change();
});
